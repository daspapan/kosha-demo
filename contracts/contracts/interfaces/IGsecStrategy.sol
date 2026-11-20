// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IGsecStrategy {
    function asset() external view returns (address);
    function totalValue() external view returns (uint256);
    function deposit(uint256 amount) external;
    function requestWithdraw(uint256 amount) external;
    function claim() external returns (uint256);
}
