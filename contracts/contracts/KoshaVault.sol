// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IKycRegistry} from "./interfaces/IKycRegistry.sol";
import {IGsecStrategy} from "./interfaces/IGsecStrategy.sol";

/// @title KoshaVault
/// @notice ERC-4626 community treasury with three pockets:
///         1. liquid buffer (idle mARC, at least 15% after any active move),
///         2. tokenised G-secs via a strategy (at most 50%),
///         3. member invoice loans (at most 35% in total, at most 5% per member).
///         The caps are constants: no role, committee vote or upgrade can change them.
///         Pausing stops new deposits, allocations and loans. It never stops withdrawals.
contract KoshaVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ---------------------------------------------------------------- roles
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE"); // timelock only
    bytes32 public constant PARTNER_ROLE = keccak256("PARTNER_ROLE"); // licensed NBFC
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE"); // may pull G-sec liquidity back to the buffer
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE"); // committee members, reconciler

    // ----------------------------------------------------------------- caps
    uint256 public constant BPS = 10_000;
    uint256 public constant BUFFER_MIN_BPS = 1_500;
    uint256 public constant GSEC_MAX_BPS = 5_000;
    uint256 public constant INVOICE_MAX_BPS = 3_500;
    uint256 public constant MEMBER_MAX_BPS = 500;
    uint256 public constant MAX_LOAN_TENOR = 180 days;
    uint256 public constant MAX_RATE_BPS = 3_000;
    uint256 public constant WRITE_OFF_GRACE = 30 days;

    // ---------------------------------------------------------------- state
    IKycRegistry public immutable kyc;
    IGsecStrategy public immutable gsec;

    uint256 public loansOutstanding; // principal of active loans
    uint256 public reservedForClaims; // assets owed to fulfilled redemption requests
    uint256 public pendingRedeemShares; // shares locked in pending requests

    enum LoanStatus { None, Active, Repaid, WrittenOff }

    struct Loan {
        address borrower;
        uint256 principal;
        uint64 openedAt;
        uint64 dueDate;
        uint16 rateBps;
        LoanStatus status;
        bytes32 invoiceHash;
    }

    enum RedeemStatus { None, Pending, Claimable, Claimed, Cancelled }

    struct RedeemRequest {
        address owner;
        uint256 shares;
        uint256 assets;
        RedeemStatus status;
    }

    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId = 1;
    mapping(address => uint256) public memberExposure;
    mapping(bytes32 => bool) public invoiceUsed;

    mapping(uint256 => RedeemRequest) public redeemRequests;
    uint256 public nextRedeemId = 1;

    // --------------------------------------------------------------- events
    event AllocatedToGsec(uint256 assets, uint256 bufferBps, uint256 gsecBps);
    event GsecWithdrawalRequested(address indexed by, uint256 assets);
    event GsecWithdrawalClaimed(uint256 assets);
    event LoanOpened(uint256 indexed id, address indexed borrower, uint256 principal, uint256 rateBps, uint256 dueDate, bytes32 invoiceHash);
    event LoanRepaid(uint256 indexed id, address indexed payer, uint256 principal, uint256 interest);
    event LoanWrittenOff(uint256 indexed id, uint256 principal);
    event RedeemRequested(uint256 indexed id, address indexed owner, uint256 shares);
    event RedeemFulfilled(uint256 indexed id, uint256 shares, uint256 assets);
    event RedeemClaimed(uint256 indexed id, address indexed owner, uint256 assets);
    event RedeemCancelled(uint256 indexed id, address indexed owner, uint256 shares);

    // --------------------------------------------------------------- errors
    error NotVerified(address account);
    error NotMember(address account);
    error ZeroAddress();
    error ZeroAmount();
    error AssetMismatch();
    error Unauthorized();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error BufferBelowMinimum();
    error GsecCapExceeded();
    error InvoiceCapExceeded();
    error MemberCapExceeded();
    error InvoiceAlreadyUsed(bytes32 invoiceHash);
    error InvalidInvoiceHash();
    error RateTooHigh();
    error BadDueDate();
    error BadLoanStatus(uint256 id);
    error GraceNotOver(uint256 availableAt);
    error BadRedeemStatus(uint256 id);
    error NotRequestOwner();
    error ReceiverNotVerified(address receiver);

    constructor(IERC20 asset_, IKycRegistry kyc_, IGsecStrategy gsec_, address admin)
        ERC20("Kosha Vault Share", "kSHARE")
        ERC4626(asset_)
    {
        if (address(kyc_) == address(0) || address(gsec_) == address(0) || admin == address(0)) revert ZeroAddress();
        if (gsec_.asset() != address(asset_)) revert AssetMismatch();
        kyc = kyc_;
        gsec = gsec_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ========================================================== accounting

    /// @notice mARC sitting in the vault and not owed to a fulfilled redemption.
    function idleAssets() public view returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        return bal > reservedForClaims ? bal - reservedForClaims : 0;
    }

    function totalAssets() public view override returns (uint256) {
        return idleAssets() + gsec.totalValue() + loansOutstanding;
    }

    /// @notice Current split in basis points. Read by the AI agent and the dashboard.
    function allocation() external view returns (uint256 bufferBps, uint256 gsecBps, uint256 invoiceBps, uint256 total) {
        total = totalAssets();
        if (total == 0) return (0, 0, 0, 0);
        bufferBps = idleAssets() * BPS / total;
        gsecBps = gsec.totalValue() * BPS / total;
        invoiceBps = loansOutstanding * BPS / total;
    }

    /// @dev Virtual-share offset against the first-depositor inflation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    // ===================================================== ERC-4626 gating

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (paused() || !kyc.isVerified(receiver)) return 0;
        return super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        if (paused() || !kyc.isVerified(receiver)) return 0;
        return super.maxMint(receiver);
    }

    /// @notice Instant withdrawals are limited only by idle liquidity. Never by pause or KYC status.
    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner), idleAssets());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return Math.min(balanceOf(owner), _convertToShares(idleAssets(), Math.Rounding.Floor));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        if (!kyc.isVerified(caller)) revert NotVerified(caller);
        if (assets == 0) revert ZeroAmount();
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        if (receiver != owner && !kyc.isVerified(receiver)) revert ReceiverNotVerified(receiver);
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /// @dev Shares move only between verified wallets. Mint and burn are not transfers,
    ///      and moves into or out of the vault itself (redemption locks) are exempt,
    ///      so a member whose KYC lapses can still exit.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && from != address(this) && to != address(this)) {
            if (!kyc.isVerified(from)) revert NotVerified(from);
            if (!kyc.isVerified(to)) revert NotVerified(to);
        }
        super._update(from, to, value);
    }

    // ===================================================== G-sec allocation

    /// @notice Moves buffer money into G-secs. Only the timelock holds ALLOCATOR_ROLE.
    function allocateToGsec(uint256 assets) external onlyRole(ALLOCATOR_ROLE) whenNotPaused nonReentrant {
        if (assets == 0) revert ZeroAmount();
        uint256 idle = idleAssets();
        if (assets > idle) revert InsufficientLiquidity(assets, idle);
        IERC20(asset()).forceApprove(address(gsec), assets);
        gsec.deposit(assets);
        uint256 ta = totalAssets();
        if (idleAssets() * BPS < ta * BUFFER_MIN_BPS) revert BufferBelowMinimum();
        if (gsec.totalValue() * BPS > ta * GSEC_MAX_BPS) revert GsecCapExceeded();
        emit AllocatedToGsec(assets, idleAssets() * BPS / ta, gsec.totalValue() * BPS / ta);
    }

    /// @notice Starts a T+1 move from G-secs back to the buffer. This only adds liquidity,
    ///         so the keeper may do it too (for redemptions), and it works while paused.
    function requestFromGsec(uint256 assets) external nonReentrant {
        if (!hasRole(ALLOCATOR_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender)) revert Unauthorized();
        gsec.requestWithdraw(assets);
        emit GsecWithdrawalRequested(msg.sender, assets);
    }

    /// @notice Anyone can finish a settled G-sec withdrawal.
    function claimFromGsec() external nonReentrant returns (uint256 assets) {
        assets = gsec.claim();
        emit GsecWithdrawalClaimed(assets);
    }

    // ======================================================= invoice loans

    /// @notice Opens a loan against an invoice the partner has verified off-chain.
    function openLoan(address borrower, uint256 principal, uint256 rateBps, uint256 dueDate, bytes32 invoiceHash)
        external
        onlyRole(PARTNER_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        if (!kyc.isVerified(borrower)) revert NotVerified(borrower);
        if (balanceOf(borrower) == 0) revert NotMember(borrower);
        if (principal == 0) revert ZeroAmount();
        if (rateBps > MAX_RATE_BPS) revert RateTooHigh();
        if (dueDate <= block.timestamp || dueDate > block.timestamp + MAX_LOAN_TENOR) revert BadDueDate();
        if (invoiceHash == bytes32(0)) revert InvalidInvoiceHash();
        if (invoiceUsed[invoiceHash]) revert InvoiceAlreadyUsed(invoiceHash);

        uint256 idle = idleAssets();
        if (principal > idle) revert InsufficientLiquidity(principal, idle);
        uint256 ta = totalAssets(); // unchanged by a loan: idle goes down, loans go up
        if ((memberExposure[borrower] + principal) * BPS > ta * MEMBER_MAX_BPS) revert MemberCapExceeded();
        if ((loansOutstanding + principal) * BPS > ta * INVOICE_MAX_BPS) revert InvoiceCapExceeded();
        if ((idle - principal) * BPS < ta * BUFFER_MIN_BPS) revert BufferBelowMinimum();

        invoiceUsed[invoiceHash] = true;
        loansOutstanding += principal;
        memberExposure[borrower] += principal;
        id = nextLoanId++;
        loans[id] = Loan(borrower, principal, uint64(block.timestamp), uint64(dueDate), uint16(rateBps), LoanStatus.Active, invoiceHash);
        IERC20(asset()).safeTransfer(borrower, principal);
        emit LoanOpened(id, borrower, principal, rateBps, dueDate, invoiceHash);
    }

    /// @notice Simple interest on elapsed time.
    function interestDue(uint256 id) public view returns (uint256) {
        Loan storage l = loans[id];
        if (l.status != LoanStatus.Active && l.status != LoanStatus.WrittenOff) return 0;
        uint256 elapsed = block.timestamp - l.openedAt;
        return l.principal * l.rateBps * elapsed / (365 days * BPS);
    }

    /// @notice Anyone may repay a loan (the member, or the exporter on her behalf). Works while paused.
    function repayLoan(uint256 id) external nonReentrant {
        Loan storage l = loans[id];
        LoanStatus s = l.status;
        if (s != LoanStatus.Active && s != LoanStatus.WrittenOff) revert BadLoanStatus(id);
        uint256 interest = interestDue(id);
        uint256 principal = l.principal;
        if (s == LoanStatus.Active) loansOutstanding -= principal;
        memberExposure[l.borrower] -= principal;
        l.status = LoanStatus.Repaid;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), principal + interest);
        emit LoanRepaid(id, msg.sender, principal, interest);
    }

    /// @notice Recognises a loss 30 days after the due date. The share price drops for everyone.
    ///         The member's exposure stays counted until the loan is recovered.
    function writeOffLoan(uint256 id) external onlyRole(PARTNER_ROLE) nonReentrant {
        Loan storage l = loans[id];
        if (l.status != LoanStatus.Active) revert BadLoanStatus(id);
        uint256 availableAt = uint256(l.dueDate) + WRITE_OFF_GRACE;
        if (block.timestamp < availableAt) revert GraceNotOver(availableAt);
        l.status = LoanStatus.WrittenOff;
        loansOutstanding -= l.principal;
        emit LoanWrittenOff(id, l.principal);
    }

    // ============================================ async redemption (7540-style)

    /// @notice Locks shares for a redemption bigger than the buffer can pay today. Works while paused.
    function requestRedeem(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert ZeroAmount();
        _transfer(msg.sender, address(this), shares);
        pendingRedeemShares += shares;
        id = nextRedeemId++;
        redeemRequests[id] = RedeemRequest(msg.sender, shares, 0, RedeemStatus.Pending);
        emit RedeemRequested(id, msg.sender, shares);
    }

    function cancelRedeem(uint256 id) external nonReentrant {
        RedeemRequest storage r = redeemRequests[id];
        if (r.owner != msg.sender) revert NotRequestOwner();
        if (r.status != RedeemStatus.Pending) revert BadRedeemStatus(id);
        r.status = RedeemStatus.Cancelled;
        pendingRedeemShares -= r.shares;
        _transfer(address(this), msg.sender, r.shares);
        emit RedeemCancelled(id, msg.sender, r.shares);
    }

    /// @notice Prices the request at today's share price and sets the assets aside.
    ///         Permissionless, so redemptions never depend on the keeper being up.
    function fulfilRedeem(uint256 id) external nonReentrant {
        RedeemRequest storage r = redeemRequests[id];
        if (r.status != RedeemStatus.Pending) revert BadRedeemStatus(id);
        uint256 assets = previewRedeem(r.shares);
        uint256 idle = idleAssets();
        if (assets > idle) revert InsufficientLiquidity(assets, idle);
        r.assets = assets;
        r.status = RedeemStatus.Claimable;
        pendingRedeemShares -= r.shares;
        _burn(address(this), r.shares);
        reservedForClaims += assets;
        emit RedeemFulfilled(id, r.shares, assets);
    }

    function claimRedeem(uint256 id) external nonReentrant {
        RedeemRequest storage r = redeemRequests[id];
        if (r.owner != msg.sender) revert NotRequestOwner();
        if (r.status != RedeemStatus.Claimable) revert BadRedeemStatus(id);
        r.status = RedeemStatus.Claimed;
        reservedForClaims -= r.assets;
        IERC20(asset()).safeTransfer(msg.sender, r.assets);
        emit RedeemClaimed(id, msg.sender, r.assets);
    }

    // ================================================================ pause

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Only the timelock (2-of-3 committee + 24 h) can unpause.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
