// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IUndelegationPolicy.sol";
import "../StreamrConfigV1_1.sol";
import "../Operator.sol";

contract DefaultUndelegationPolicy is Operator, IUndelegationPolicy {

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IUndelegationPolicy).interfaceId;
    }

    function setParam(uint) external {

    }

    /**
     * Check the operator's self-undelegation limit i.e. how much of the Operator token supply does the operator have as "skin in the game".
     * For others, it's always OK to undelegate.
     * After self-undelegation, operator must still hold at least minimumSelfDelegationFraction of the total supply.
     * @dev NOTE that amount can be anything, including more than the actual delegated DATA balance.
     * @dev If there's lots of undelegation queue, those tokens still count for the totalSupply.
     * @dev   This means if the queue is left un-serviced, the operator's effective self-delegation limit is higher.
     * @dev Minimum delegation limit isn't checked here because this check happens while queueing.
     * @dev   Minimum delegation is handled when paying out the queue, and checked separately on _transfer.
     **/
    function onUndelegate(address delegator, uint amountDataWei) external {
        StreamrConfigV1_1 config = StreamrConfigV1_1(address(streamrConfig));
        if (delegator == owner) {
            // if all has been unstaked, no slashing can be coming that requires self-stake => allow self-undelegation ("rapid shutdown")
            // otherwise the operator would have to wait for all delegators to undelegate first
            if (totalStakedIntoSponsorshipsWei == 0) { return; }

            uint amountOperatorTokens = moduleCall(address(exchangeRatePolicy), abi.encodeWithSelector(exchangeRatePolicy.operatorTokenToDataInverse.selector, amountDataWei));
            uint actualAmount = min(amountOperatorTokens, balanceOf(owner));
            uint balanceAfter = balanceOf(owner) - actualAmount;
            uint totalSupplyAfter = totalSupply() - actualAmount;
            uint minimumFraction = 0;
            try config.minimumSelfDelegationFraction() returns (uint f) {
                minimumFraction = f;
            } catch {}
            require(1 ether * balanceAfter >= totalSupplyAfter * minimumFraction, "error_selfDelegationTooLow");
        } else {
            uint minimumSeconds = 0;
            try config.minimumDelegationSeconds() returns (uint s) {
                minimumSeconds = s;
            } catch {}
            // solhint-disable-next-line not-rely-on-time
            require(block.timestamp > latestDelegationTimestamp[delegator] + minimumSeconds, "error_undelegateTooSoon");
        }
    }
}
