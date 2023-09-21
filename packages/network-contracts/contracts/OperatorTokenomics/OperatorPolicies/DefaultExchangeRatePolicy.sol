// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IExchangeRatePolicy.sol";
import "../Operator.sol";

contract DefaultExchangeRatePolicy is IExchangeRatePolicy, Operator {

    function setParam(uint) external {

    }

    /**
     * Exchange rate from Operator's internal token to DATA when undelegating
     * We calculate using valueWithoutEarnings() because smart contract's can't check the outstanding earnings of arbitrary number of Sponsorships
     * @param operatorTokenWei Amount of Operator's internal token
     */
    function undelegationRate(uint operatorTokenWei) external view returns (uint dataWei) {
        // don't guard against this.totalSupply() == 0 because: no tokens in supply => nothing to undelegate => ?!
        return operatorTokenWei * valueWithoutEarnings() / this.totalSupply();
    }

    /**
     * Exchange rate from DATA to Operator's internal token when delegating
     * We calculate using valueWithoutEarnings() because smart contract's can't check the outstanding earnings of arbitrary number of Sponsorships
     * First delegation should be the operator's self-delegation. For that, use 1:1 exchange rate.
     * NOTE: this function can be called after the DATA tokens have actually been transferred (which is typically the case),
     *       the exchange rate is just adjusted accordingly by subtracting alreadyTransferredWei from the Operator value
     * @param dataWei Amount of DATA token
     * @param alreadyTransferredWei Amount of DATA to subtract from Operator value for calculations (because DATA balance already was incremented but calculation needs the pre-increment value)
     **/
    function delegationRate(uint dataWei, uint alreadyTransferredWei) external view returns (uint operatorTokenWei) {
        if (this.totalSupply() == 0) {
            // start with 1:1 exchange rate
            return dataWei;
        }

        uint operatorValue = valueWithoutEarnings();
        require(alreadyTransferredWei < operatorValue, "error_badArgument_alreadyTransferredWei");

        return dataWei * this.totalSupply() / (operatorValue - alreadyTransferredWei);
    }
}
