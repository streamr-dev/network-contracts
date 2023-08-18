import { Wallet, ContractReceipt, utils } from "ethers"
import { Operator } from "../../../typechain"
import { TestContracts } from "./deployTestContracts"

const { parseEther } = utils

let poolindex = 0

/**
 * @param deployer should be the operator's Wallet
 * @param operatorsCutFraction as a fraction of 10^18, like ether
 * @returns Promise<Operator>
 */
export async function deployOperatorContract(
    contracts: TestContracts,
    deployer: Wallet,
    operatorsCutFraction = parseEther("0"),
    operatorMetadata = "{}",
    salt?: string
): Promise<Operator> {
    const {
        operatorFactory, operatorTemplate,
        defaultDelegationPolicy, defaultPoolYieldPolicy, defaultUndelegationPolicy
    } = contracts
    const poolTokenName = salt ?? `Pool-${Date.now()}-${poolindex++}`

    /**
     * @param operatorsCutFraction as a fraction of 10^18, like ether (use parseEther)
     * @param stringArgs [0] poolTokenName, [1] streamMetadata
     * @param policies smart contract addresses, must be in the trustedPolicies: [0] delegation, [1] yield, [2] undelegation policy
     * @param policyParams not used for default policies: [0] delegation, [1] yield, [2] undelegation policy param
     */
    const operatorReceipt = await (await operatorFactory.connect(deployer).deployOperator(
        operatorsCutFraction,
        poolTokenName,
        operatorMetadata,
        [ defaultDelegationPolicy.address, defaultPoolYieldPolicy.address, defaultUndelegationPolicy.address ],
        [ 0, 0, 0 ]
    )).wait() as ContractReceipt // TODO: figure out why typechain types produce any from .connect, shouldn't need explicit typing here
    const newOperatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    return operatorTemplate.attach(newOperatorAddress).connect(deployer)
}
