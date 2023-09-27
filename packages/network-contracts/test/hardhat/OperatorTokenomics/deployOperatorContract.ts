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
    opts?: any,
    salt?: string
): Promise<Operator> {
    const {
        operatorFactory, operatorTemplate,
        defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy
    } = contracts
    const operatorTokenName = salt ?? `Pool-${Date.now()}-${poolindex++}`

    /**
     * @param operatorsCutFraction as a fraction of 10^18, like ether (use parseEther)
     * @param stringArgs [0] operatorTokenName, [1] streamMetadata
     * @param policies smart contract addresses, must be in the trustedPolicies: [0] delegation, [1] exchange rate, [2] undelegation policy
     * @param policyParams not used for default policies: [0] delegation, [1] exchange rate, [2] undelegation policy param
     */
    const operatorReceipt = await (await operatorFactory.connect(deployer).deployOperator(
        operatorsCutFraction,
        operatorTokenName,
        opts?.metadata || "{}",
        [
            opts?.overrideDelegationPolicy || defaultDelegationPolicy.address,
            opts?.overrideExchangeRatePolicy || defaultExchangeRatePolicy.address,
            opts?.overrideUndelegationPolicy || defaultUndelegationPolicy.address
        ],
        [ 0, 0, 0 ]
    )).wait() as ContractReceipt // TODO: figure out why typechain types produce any from .connect, shouldn't need explicit typing here
    const newOperatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    return operatorTemplate.attach(newOperatorAddress).connect(deployer)
}
