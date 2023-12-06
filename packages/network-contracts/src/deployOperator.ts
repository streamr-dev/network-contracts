import { Contract } from "@ethersproject/contracts"
import { parseEther } from "@ethersproject/units"
import type { Wallet } from "@ethersproject/wallet"

import { Operator } from "../typechain"
import type { StreamrContracts } from "./StreamrEnvDeployer"
import { operatorABI } from "./exports"

let operatorCounter = 0

/**
 * @param deployer should be the operator's Wallet
 * @param operatorsCutFraction as a fraction of 10^18, like ether
 * @returns Promise<Operator>
 */
export async function deployOperator(
    contracts: StreamrContracts,
    deployer: Wallet,
    operatorsCutFraction = parseEther("0"),
    opts: {
        metadata?: string,
        overrideDelegationPolicy?: string,
        overrideExchangeRatePolicy?: string,
        overrideUndelegationPolicy?: string
    } = {},
    salt?: string
): Promise<Operator> {
    const {
        operatorFactory,
        defaultDelegationPolicy,
        defaultExchangeRatePolicy,
        defaultUndelegationPolicy,
    } = contracts
    const operatorTokenName = salt ?? `Operator-${Date.now()}-${operatorCounter++}`

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
    )).wait() // as ContractReceipt
    const newOperatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    return new Contract(newOperatorAddress, operatorABI, deployer) as Operator
}
