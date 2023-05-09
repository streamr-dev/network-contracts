import { Wallet, ContractReceipt, utils } from "ethers"
import { Operator } from "../../../typechain"
import { TestContracts } from "./deployTestContracts"

const { parseEther } = utils

let poolindex = 0

/**
 * @param deployer should be the operator's Wallet
 * @returns Operator
 */
export async function deployOperatorContract(contracts: TestContracts, deployer: Wallet, {
    minimumMarginFraction = 0,
    // minOperatorStakePercent = 0,
    operatorSharePercent = 0,
    operatorMetadata = "{}",
} = {}, salt?: string): Promise<Operator> {
    const {
        operatorFactory, operatorTemplate,
        defaultDelegationPolicy, defaultPoolYieldPolicy, defaultUndelegationPolicy
    } = contracts
    // TODO: figure out if initialMargin is needed twice...
    const initialMargin = "0"
    const poolTokenName = salt ?? `Pool-${Date.now()}-${poolindex++}`

    /**
     * policies, // [0] delegation, [1] yield, [2] undelegation policy
     * [0] initialMargin, [1] minimumMarginFraction, [2] yieldPolicyParam, [3] undelegationPolicyParam,
     *      [4] initialMinimumDelegationWei, [5] operatorsShareFraction
     */
    const operatorReceipt = await (await operatorFactory.connect(deployer).deployOperator(
        [ poolTokenName, operatorMetadata ],
        [
            defaultDelegationPolicy.address,
            defaultPoolYieldPolicy.address,
            defaultUndelegationPolicy.address
        ],
        [
            initialMargin, minimumMarginFraction, 0, 0, 0, parseEther("1").mul(operatorSharePercent).div(100)
        ]
    )).wait() as ContractReceipt // TODO: figure out why typechain types produce any from .connect, shouldn't need explicit typing here
    const newOperatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    return operatorTemplate.attach(newOperatorAddress).connect(deployer)
}
