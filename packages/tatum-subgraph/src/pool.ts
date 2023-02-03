import { log } from '@graphprotocol/graph-ts'

import { BrokerPool, PoolInvestment, Stake } from '../generated/schema'
import { InvestmentReceived, Staked } from '../generated/templates/BrokerPool/BrokerPool'

export function handleInvestmentReceived (event: InvestmentReceived): void {
    log.info('handleInvestmentReceived: pooladdress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    let pool = BrokerPool.load(event.address.toHexString())
    pool!.investorCount = pool!.investorCount + 1
    
    pool!.save()

    let investment = PoolInvestment.load(event.params.investor.toHexString())
    if (investment === null) {
        investment = new PoolInvestment(event.params.investor.toHexString())
        investment.pool = event.address.toHexString()
        investment.id =  event.address.toHexString() + "-" + event.params.investor.toHexString()
        investment.investor = event.params.investor.toHexString()
    }
    investment.amount = event.params.amountWei
    investment.save()
}

// export function handleStakeUpdated (event: Staked): void {
//     log.info('handleStakeUpdated: sidechainaddress={} allocation={}', [event.address.toHexString(),  event.params.amountWei.toString()])
//     let bountyAddress = event.params.bounty
//     let brokerAddress = event.address

//     let stakeID = brokerAddress.toHexString() + "-" + bountyAddress.toHexString()
//     let stake = Stake.load(stakeID)
//     if (stake === null) {
//         stake = new Stake(stakeID)
//         stake.bounty = bountyAddress.toHexString()
//         stake.id = stakeID
//         stake.broker = brokerAddress.toHexString()
//     }
//     stake.date = event.block.timestamp
//     stake.amount = event.params.amountWei
//     stake.save()
// }
