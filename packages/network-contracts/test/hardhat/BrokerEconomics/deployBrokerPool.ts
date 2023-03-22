import { Wallet, ContractReceipt } from "ethers"
import { BrokerPool } from "../../../typechain"
import { TestContracts } from "./deployTestContracts"

let poolindex = 0

/**
 * @param deployer should be the broker's Wallet
 * @returns BrokerPool
 */
export async function deployBrokerPool(contracts: TestContracts, deployer: Wallet, {
    maintenanceMarginPercent = 0,
    maxBrokerDivertPercent = 0,
    minBrokerStakePercent = 0,
    brokerSharePercent = 0,
} = {}, salt?: string): Promise<BrokerPool> {
    const {
        poolFactory, poolTemplate,
        defaultPoolJoinPolicy, defaultPoolYieldPolicy, defaultPoolExitPolicy
    } = contracts
    // TODO: figure out if initialMargin is needed twice...
    const initialMargin = "0"
    const create2Salt = salt ?? `Pool-${Date.now()}-${poolindex++}`

    /** TODO: update after cleaning up the BrokerPoolFactory
     * Policies array corresponds to the initParams array as follows:
     *  [0]: join policy => [0] initialMargin, [1] minimumMarginPercent
     *  [1]: yield policy => [2] initialMargin, [3] maintenanceMargin, [4] minimumMargin, [5] brokerShare, [6] brokerShareMaxDivert
     *  [2]: exit policy => [7]
     */
    const brokerPoolReceipt = await (await poolFactory.connect(deployer).deployBrokerPool(
        0,
        create2Salt,
        [
            defaultPoolJoinPolicy.address,
            defaultPoolYieldPolicy.address,
            defaultPoolExitPolicy.address
        ], [
            initialMargin, minBrokerStakePercent,
            initialMargin, maintenanceMarginPercent, minBrokerStakePercent, brokerSharePercent, maxBrokerDivertPercent,
            0
        ]
    )).wait() as ContractReceipt // TODO: figure out why typechain types produce any from .connect, shouldn't need explicit typing here
    const newPoolAddress = brokerPoolReceipt.events?.find((e) => e.event === "NewBrokerPool")?.args?.poolAddress
    return poolTemplate.attach(newPoolAddress).connect(deployer)
}
