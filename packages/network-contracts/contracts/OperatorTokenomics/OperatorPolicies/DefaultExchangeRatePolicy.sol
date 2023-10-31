// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IExchangeRatePolicy.sol";
import "../Operator.sol";

contract DefaultExchangeRatePolicy is IExchangeRatePolicy, Operator {

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IExchangeRatePolicy).interfaceId;
    }

    function setParam(uint) external {

    }

    /**
     * Conversion from Operator's internal token to DATA when undelegating
     * We calculate using valueWithoutEarnings() because smart contract's can't check the outstanding earnings of arbitrary number of Sponsorships
     * Rounding is DOWN, so that we don't give away more DATA than we should
     * @param operatorTokenWei Amount of Operator's internal token to undelegate
     * @return dataWei Amount of DATA token that would be received from the undelegation
     */
    function operatorTokenToData(uint operatorTokenWei) external view returns (uint dataWei) {
        // guards against queue payout when totalSupply() == 0
        // zero totalSupply but non-zero valueWithoutEarnings can be caused by sending DATA to the operator contract without transferAndCall (using ERC20.transfer)
        // also no one can get the DATA in that case, except the operator by doing the first self-delegation
        if (totalSupply() == 0) {
            return 0;
        }
        return operatorTokenWei * valueWithoutEarnings() / totalSupply();
    }

    /**
     * Conversion from DATA to Operator's internal token when undelegating
     * We calculate using valueWithoutEarnings() because smart contract's can't check the outstanding earnings of arbitrary number of Sponsorships
     * Rounding is UP, so that we get AT MOST the requested amount of DATA when burning the returned amount of Operator's internal token
     * @param dataWei Amount of DATA we want from undelegating
     * @return operatorTokenWei Amount of Operator's internal token to undelegate to receive the given amount of DATA
     */
    function operatorTokenToDataInverse(uint dataWei) external view returns (uint operatorTokenWei) {
        uint operatorValue = valueWithoutEarnings();
        return (dataWei * totalSupply() + operatorValue - 1) / operatorValue;
    }

    /**
     * Conversion from DATA to Operator's internal token when delegating
     * We calculate using valueWithoutEarnings() because smart contract's can't check the outstanding earnings of arbitrary number of Sponsorships
     * First delegation should be the operator's self-delegation. For that, use 1:1 exchange rate.
     * NOTE: this function can be called after the DATA tokens have actually been transferred (which is typically the case),
     *       the exchange rate is just adjusted accordingly by subtracting alreadyTransferredWei from the Operator value
     * @param dataWei Amount of DATA token to delegate
     * @param alreadyTransferredWei Amount of DATA to subtract from Operator value for calculations (because DATA balance already was incremented but calculation needs the pre-increment value)
     * @return operatorTokenWei Amount of Operator's internal token that would be received from the delegation
     **/
    function dataToOperatorToken(uint dataWei, uint alreadyTransferredWei) external view returns (uint operatorTokenWei) {
        if (totalSupply() == 0) {
            // start with 1:1 exchange rate
            return dataWei;
        }

        // operatorValue == alreadyTransferredWei => this was the first delegation => totalsupply should still be 0 => we shouldn't be able to divide by zero
        uint operatorValue = valueWithoutEarnings();
        return dataWei * totalSupply() / (operatorValue - alreadyTransferredWei);
    }
}
