import { Chain } from "@streamr/config"
import { Wallet, ContractReceipt, Contract, utils } from "ethers"

import { abi as operatorAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/Operator.sol/Operator.json"
import { abi as operatorFactoryAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/OperatorFactory.sol/OperatorFactory.json"

import type { Operator, OperatorFactory } from "../../network-contracts/typechain"
import { AddressZero } from "@ethersproject/constants"

const { parseEther } = utils

/**
 * @param deployer should be the operator's Wallet
 * @returns Operator
 */
export async function deployOperatorContract(
    chainConfig: Chain, deployer: Wallet, {
        minOperatorStakePercent = 0,
        operatorSharePercent = 0,
        operatorMetadata = "{}",
    } = {}, poolTokenName = `Pool-${Date.now()}`): Promise<Operator> {

    const operatorFactory = new Contract(chainConfig.contracts.OperatorFactory, operatorFactoryAbi, deployer) as unknown as OperatorFactory

    const contractAddress = await operatorFactory.operators(deployer.address)
    // if (await operatorFactory.operators(contractAddress) === deployer.address)) {
    if (contractAddress !== AddressZero) {
        throw new Error("Operator already has a contract")
    }
    /**
     * policies: [0] delegation, [1] yield, [2] undelegation policy
     * uint params: [0] initialMargin, [1] minimumMarginFraction, [2] yieldPolicyParam, [3] undelegationPolicyParam,
     *      [4] initialMinimumDelegationWei, [5] operatorsShareFraction
     */

    const operatorReceipt = await (await operatorFactory.deployOperator(
        [ poolTokenName, operatorMetadata ],
        [
            chainConfig.contracts.DefaultDelegationPolicy,
            chainConfig.contracts.DefaultPoolYieldPolicy,
            chainConfig.contracts.DefaultUndelegationPolicy,
        ], [
            0,
            parseEther("1").mul(minOperatorStakePercent).div(100),
            0,
            0,
            0,
            parseEther("1").mul(operatorSharePercent).div(100)
        ]
    )).wait() as ContractReceipt // TODO: figure out why typechain types produce any from .connect, shouldn't need explicit typing here
    const newOperatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    const newOperator = new Contract(newOperatorAddress, operatorAbi, deployer) as unknown as Operator
    return newOperator
}
