// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IKycRegistry} from "./interfaces/IKycRegistry.sol";

/// @title KycRegistry
/// @notice Allow-list of wallets the licensed partner has KYC-verified.
contract KycRegistry is IKycRegistry, AccessControl {
    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");

    mapping(address => bool) private _verified;

    event KycSet(address indexed account, bool verified);

    error ZeroAddress();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setVerified(address account, bool verified) public onlyRole(KYC_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        _verified[account] = verified;
        emit KycSet(account, verified);
    }

    function setVerifiedBatch(address[] calldata accounts, bool verified) external onlyRole(KYC_ADMIN_ROLE) {
        for (uint256 i = 0; i < accounts.length; i++) {
            setVerified(accounts[i], verified);
        }
    }

    function isVerified(address account) external view returns (bool) {
        return _verified[account];
    }
}
