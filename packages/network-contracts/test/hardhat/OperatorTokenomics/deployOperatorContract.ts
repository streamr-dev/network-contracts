import { Wallet, ContractReceipt } from "ethers"
import { Operator } from "../../../typechain"
import { TestContracts } from "./deployTestContracts"

let poolindex = 0

/**
 * @param deployer should be the operator's Wallet
 * @returns Operator
 */
export async function deployOperatorContract(contracts: TestContracts, deployer: Wallet, {
    maintenanceMarginPercent = 0,
    maxOperatorDivertPercent = 0,
    minOperatorStakePercent = 0,
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

    /** TODO: update after cleaning up the OperatorFactory
     * Policies array corresponds to the initParams array as follows:
     *  [0]: join policy => [0] initialMargin, [1] minimumMarginPercent
     *  [1]: yield policy => [2] initialMargin, [3] maintenanceMargin, [4] minimumMargin, [5] operatorShare, [6] operatorShareMaxDivert
     *  [2]: undelegation policy => [7]
     */
    const operatorReceipt = await (await operatorFactory.connect(deployer).deployOperator(
        0,
        [ poolTokenName, operatorMetadata ],
        [
            defaultDelegationPolicy.address,
            defaultPoolYieldPolicy.address,
            defaultUndelegationPolicy.address
        ], [
            initialMargin, minOperatorStakePercent,
            initialMargin, maintenanceMarginPercent, minOperatorStakePercent, operatorSharePercent, maxOperatorDivertPercent,
            0
        ]
    )).wait() as ContractReceipt // TODO: figure out why typechain types produce any from .connect, shouldn't need explicit typing here
    const newOperatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    return operatorTemplate.attach(newOperatorAddress).connect(deployer)
}
