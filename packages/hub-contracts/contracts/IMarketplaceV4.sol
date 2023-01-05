// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IMarketplaceV4 {
    // project events
    event ProjectPurchased(bytes32 projectId, address subscriber, uint256 subscriptionSeconds, uint256 price, uint256 fee);
   
    // txFee events
    event TxFeeChanged(uint256 indexed newTxFee);

    // admin functionality events
    event Halted();
    event Resumed();

    function buy(bytes32 projectId, uint subscriptionSeconds) external;
    function buyFor(bytes32 projectId, uint subscriptionSeconds, address recipient) external;
    function onTokenTransfer(address sender, uint256 amount, bytes calldata data) external;

    function addCrossChainInbox(uint32 originDomainId, address inboxAddress) external;
    function addCrossChainMarketplace(uint32 originDomainId, address remoteMarketplaceAddress) external;
    function getPurchaseInfo(
        bytes32 projectId,
        uint256 subscriptionSeconds,
        uint32 originDomainId,
        uint256 purchaseId
    ) external view returns(address, address, uint256, uint256, uint256);
}
