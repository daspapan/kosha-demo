// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IKycRegistry {
    function isVerified(address account) external view returns (bool);
}
