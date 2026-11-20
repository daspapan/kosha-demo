// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockARC} from "./tokens/MockARC.sol";
import {IKycRegistry} from "./interfaces/IKycRegistry.sol";

/// @title PartnerGateway
/// @notice The licensed partner's bridge between eINR and mARC.
///         Invariant: eINR held here == mARC total supply + pending deposits.
contract PartnerGateway is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PARTNER_ROLE = keccak256("PARTNER_ROLE");
    uint256 public constant CANCEL_AFTER = 3 days;

    enum Status { None, Pending, Settled, Rejected, Cancelled }

    struct DepositRequest {
        address member;
        uint256 amount;
        uint64 createdAt;
        Status status;
    }

    IERC20 public immutable eInr;
    MockARC public immutable arc;
    IERC4626 public immutable vault;
    IKycRegistry public immutable kyc;

    mapping(uint256 => DepositRequest) public deposits;
    mapping(bytes32 => uint256) public depositIdByKey;
    uint256 public nextDepositId = 1;
    uint256 public pendingDeposits;

    event DepositRequested(uint256 indexed id, address indexed member, uint256 amount, bytes32 clientKey);
    event DepositSettled(uint256 indexed id, address indexed member, uint256 amount, uint256 shares);
    event DepositRejected(uint256 indexed id, address indexed member, uint256 amount);
    event DepositCancelled(uint256 indexed id, address indexed member, uint256 amount);
    event CashIn(address indexed account, uint256 amount);
    event CashOut(address indexed account, uint256 amount);

    error NotVerified(address account);
    error ZeroAmount();
    error ZeroAddress();
    error DuplicateRequest(uint256 existingId);
    error NotPending(uint256 id);
    error NotRequester();
    error TooEarly(uint256 availableAt);

    constructor(IERC20 eInr_, MockARC arc_, IERC4626 vault_, IKycRegistry kyc_, address admin, address partner) {
        if (
            address(eInr_) == address(0) || address(arc_) == address(0) || address(vault_) == address(0)
                || address(kyc_) == address(0) || admin == address(0) || partner == address(0)
        ) revert ZeroAddress();
        eInr = eInr_;
        arc = arc_;
        vault = vault_;
        kyc = kyc_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARTNER_ROLE, partner);
    }

    /// @notice Member locks eINR and asks the partner to deposit it into the vault.
    /// @param clientKey Idempotency key from the app. Reusing it reverts, so a retried request cannot double-deposit.
    function requestDeposit(uint256 amount, bytes32 clientKey) external nonReentrant returns (uint256 id) {
        if (!kyc.isVerified(msg.sender)) revert NotVerified(msg.sender);
        if (amount == 0) revert ZeroAmount();
        bytes32 key = keccak256(abi.encode(msg.sender, clientKey));
        if (clientKey != bytes32(0)) {
            uint256 existing = depositIdByKey[key];
            if (existing != 0) revert DuplicateRequest(existing);
        }
        id = nextDepositId++;
        if (clientKey != bytes32(0)) depositIdByKey[key] = id;
        deposits[id] = DepositRequest(msg.sender, amount, uint64(block.timestamp), Status.Pending);
        pendingDeposits += amount;
        eInr.safeTransferFrom(msg.sender, address(this), amount);
        emit DepositRequested(id, msg.sender, amount, clientKey);
    }

    /// @notice Partner converts the locked eINR to mARC 1:1 and deposits it for the member.
    function settleDeposit(uint256 id) external onlyRole(PARTNER_ROLE) nonReentrant returns (uint256 shares) {
        DepositRequest storage d = deposits[id];
        if (d.status != Status.Pending) revert NotPending(id);
        d.status = Status.Settled;
        pendingDeposits -= d.amount;
        arc.mint(address(this), d.amount);
        IERC20(address(arc)).forceApprove(address(vault), d.amount);
        shares = vault.deposit(d.amount, d.member);
        emit DepositSettled(id, d.member, d.amount, shares);
    }

    function rejectDeposit(uint256 id) external onlyRole(PARTNER_ROLE) nonReentrant {
        DepositRequest storage d = deposits[id];
        if (d.status != Status.Pending) revert NotPending(id);
        d.status = Status.Rejected;
        pendingDeposits -= d.amount;
        eInr.safeTransfer(d.member, d.amount);
        emit DepositRejected(id, d.member, d.amount);
    }

    /// @notice If the partner never acts, the member gets the eINR back after 3 days.
    function cancelDeposit(uint256 id) external nonReentrant {
        DepositRequest storage d = deposits[id];
        if (d.status != Status.Pending) revert NotPending(id);
        if (d.member != msg.sender) revert NotRequester();
        uint256 availableAt = uint256(d.createdAt) + CANCEL_AFTER;
        if (block.timestamp < availableAt) revert TooEarly(availableAt);
        d.status = Status.Cancelled;
        pendingDeposits -= d.amount;
        eInr.safeTransfer(d.member, d.amount);
        emit DepositCancelled(id, d.member, d.amount);
    }

    /// @notice Verified accounts swap eINR for mARC 1:1 (used for loan repayment and coupons).
    function cashIn(uint256 amount) external nonReentrant {
        if (!kyc.isVerified(msg.sender)) revert NotVerified(msg.sender);
        if (amount == 0) revert ZeroAmount();
        eInr.safeTransferFrom(msg.sender, address(this), amount);
        arc.mint(msg.sender, amount);
        emit CashIn(msg.sender, amount);
    }

    /// @notice Anyone holding mARC can exit to eINR 1:1. No KYC check, so a revoked member is never trapped.
    function cashOut(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(address(arc)).safeTransferFrom(msg.sender, address(this), amount);
        arc.burn(amount);
        eInr.safeTransfer(msg.sender, amount);
        emit CashOut(msg.sender, amount);
    }
}
