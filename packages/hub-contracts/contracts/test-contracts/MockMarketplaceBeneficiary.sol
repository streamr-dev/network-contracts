// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

contract MockMarketplaceBeneficiary {
    event NotifyBeneficiaryOnProductPurchase(address recipient, uint256 value, bytes data);

    function onTokenTransfer(address recipient, uint256 value, bytes calldata data) public {
        emit NotifyBeneficiaryOnProductPurchase(recipient, value, data);
    }
}
