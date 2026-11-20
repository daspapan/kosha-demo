// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IGsecStrategy} from "../interfaces/IGsecStrategy.sol";

/// @title MockGsecStrategy
/// @notice Stand-in for tokenised T-bills held through a regulated RWA issuer.
///         Value = mARC held here. Yield arrives as coupons paid in by the issuer,
///         so no unbacked tokens are ever minted. Withdrawals settle T+1.
contract MockGsecStrategy is IGsecStrategy, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    uint256 public constant SETTLEMENT_DELAY = 1 days;
    uint256 public constant MAX_APR_BPS = 2_000;

    IERC20 private immutable _asset;
    address public vault;
    uint256 public aprBps;
    uint256 public pendingWithdrawal;
    uint256 public readyAt;

    event VaultSet(address indexed vault);
    event Deposited(uint256 amount);
    event WithdrawalRequested(uint256 amount, uint256 totalPending, uint256 readyAt);
    event WithdrawalClaimed(uint256 amount);
    event CouponPaid(address indexed payer, uint256 amount);
    event AprSet(uint256 aprBps);

    error NotVault();
    error VaultAlreadySet();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientValue();
    error NotReady();
    error NothingPending();
    error AprTooHigh();

    constructor(IERC20 asset_, address admin, address issuer, uint256 aprBps_) {
        if (address(asset_) == address(0) || admin == address(0) || issuer == address(0)) revert ZeroAddress();
        if (aprBps_ > MAX_APR_BPS) revert AprTooHigh();
        _asset = asset_;
        aprBps = aprBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, issuer);
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    /// @notice One-time wiring. Cannot be changed afterwards.
    function setVault(address vault_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vault != address(0)) revert VaultAlreadySet();
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
        emit VaultSet(vault_);
    }

    function asset() external view returns (address) {
        return address(_asset);
    }

    function totalValue() public view returns (uint256) {
        return _asset.balanceOf(address(this));
    }

    function deposit(uint256 amount) external onlyVault {
        if (amount == 0) revert ZeroAmount();
        _asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(amount);
    }

    /// @notice Starts a T+1 withdrawal. A new request restarts the clock for the whole pending amount.
    function requestWithdraw(uint256 amount) external onlyVault {
        if (amount == 0) revert ZeroAmount();
        if (pendingWithdrawal + amount > totalValue()) revert InsufficientValue();
        pendingWithdrawal += amount;
        readyAt = block.timestamp + SETTLEMENT_DELAY;
        emit WithdrawalRequested(amount, pendingWithdrawal, readyAt);
    }

    function claim() external onlyVault returns (uint256 amount) {
        amount = pendingWithdrawal;
        if (amount == 0) revert NothingPending();
        if (block.timestamp < readyAt) revert NotReady();
        pendingWithdrawal = 0;
        _asset.safeTransfer(msg.sender, amount);
        emit WithdrawalClaimed(amount);
    }

    /// @notice Anyone may pay a coupon in. In the demo the issuer account does it daily.
    function payCoupon(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _asset.safeTransferFrom(msg.sender, address(this), amount);
        emit CouponPaid(msg.sender, amount);
    }

    function setAprBps(uint256 aprBps_) external onlyRole(ISSUER_ROLE) {
        if (aprBps_ > MAX_APR_BPS) revert AprTooHigh();
        aprBps = aprBps_;
        emit AprSet(aprBps_);
    }
}
