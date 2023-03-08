import { log } from '@graphprotocol/graph-ts'

import { BrokerPool, PoolDelegation } from '../generated/schema'
import { Delegated } from '../generated/templates/BrokerPool/BrokerPool'

export function handleDelegationReceived (event: Delegated): void {
    log.info('handleDelegationReceived: pooladdress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    let pool = BrokerPool.load(event.address.toHexString())
    pool!.delegatorCount = pool!.delegatorCount + 1
    
    pool!.save()

    let delegation = PoolDelegation.load(event.params.delegator.toHexString())
    if (delegation === null) {
        delegation = new PoolDelegation(event.params.delegator.toHexString())
        delegation.pool = event.address.toHexString()
        delegation.id =  event.address.toHexString() + "-" + event.params.delegator.toHexString()
        delegation.delegator = event.params.delegator.toHexString()
    }
    delegation.amount = event.params.amountWei
    delegation.save()
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
