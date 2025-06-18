// SPDX-License-Identifier: MIT
/* solhint-disable no-console */

pragma solidity ^0.8.9;


import "../Hub/Marketplace/IMarketplaceV4.sol";
import "hardhat/console.sol";

interface IMessageRecipient {
    function handle(
        uint32 _origin, // the chain id of the remote chain. Unique id assigned by Hyperlane (the same as the chainId in the EIP-155).
        bytes32 _sender, // the contract address on the remote chain (e.g. RemoteMarketplace). It must match or the message will revert
        bytes calldata _message // encoded purchase info
    ) external;
}


contract GasReporter {
    address public recipient;
    uint32 public chainId;

    constructor(address _recipient, uint32 _chainId) {
        recipient = _recipient;
        chainId = _chainId;
    }

    function handle(
        bytes32 projectId,
        address subscriber,
        uint256 subscriptionSeconds,
        address beneficiary,
        uint256 price,
        uint256 fee
    ) public {
        bytes memory message = abi.encode(projectId, subscriber, subscriptionSeconds, beneficiary, price, fee);
        uint gasBefore = gasleft();

        IMessageRecipient(recipient).handle(
            chainId,
            _addressToBytes32(address(this)),
            message
        );

        uint gasAfter = gasleft();
        console.log("Gas used for handle function is %s wei", gasBefore - gasAfter);
    }

    function _addressToBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function getPurchaseInfo(
        bytes32 projectId,
        uint256 subscriptionSeconds,
        uint256 purchaseId
    ) external view {
        uint gasBefore = gasleft();

        // (address beneficiary, address pricingTokenAddress, uint256 price, uint256 fee, , uint256 streamsCount) =
            IMarketplaceV4(recipient).getPurchaseInfo(projectId, subscriptionSeconds, chainId, purchaseId);

        uint gasAfter = gasleft();
        console.log("Gas used for getPurchaseInfo function is %s wei", gasBefore - gasAfter);
    }

    function getSubscriptionInfo(
        bytes32 projectId,
        address subscriber,
        uint256 purchaseId
    ) external view {
        uint gasBefore = gasleft();

        // (bool isValid, uint256 subEndTimestamp, ) =
            IMarketplaceV4(recipient).getSubscriptionInfo(projectId, subscriber, purchaseId);

        uint gasAfter = gasleft();
        console.log("Gas used for getSubscriptionInfo function is %s wei", gasBefore - gasAfter);
    }
}
