// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IDelegationPolicy.sol";
import "../Operator.sol";

contract DefaultDelegationPolicy is IDelegationPolicy, Operator {

    struct LocalStorage {
        uint256 initialMargin;
        uint256 minimumMarginPercent;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("operator.storage.DefaultDelegationPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint256 initialMargin, uint256 minimumMarginPercent) external {
        LocalStorage storage data = localData();
        data.initialMargin = initialMargin;
        data.minimumMarginPercent = minimumMarginPercent;
    }

    /** @return allowedToJoin must be 0 for false, or 1 for true */
    function canJoin(address delegator) external view returns (uint allowedToJoin) {

        // can't join into an empty pool (unless it's the operator itself, or we don't require a minimum margin)
        if (delegator == owner || localData().minimumMarginPercent == 0) { return 1; }
        if (totalSupply() == 0) { return 0; }

        // check minimum margin i.e. how much of the pool does the operator have as "skin in the game"
        if (balanceOf(owner) * 100 / totalSupply() >= localData().minimumMarginPercent) { return 1; }
        return 0;
    }
}
