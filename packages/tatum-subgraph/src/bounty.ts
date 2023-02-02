import { log } from '@graphprotocol/graph-ts'

import { Bounty, Stake } from '../generated/schema'
import { StakeUpdate, BountyUpdate } from '../generated/templates/Bounty/Bounty'

export function handleStakeUpdated(event: StakeUpdate): void {
    log.info('handleStakeUpdated: sidechainaddress={} allocation={}', [event.address.toHexString(),  event.params.allocatedWei.toString()])
    let bountyAddress = event.address
    let brokerAddress = event.params.broker

    let stakeID = bountyAddress.toHexString() + "-" + brokerAddress.toHexString()
    let stake = Stake.load(stakeID)
    if (stake === null) {
        stake = new Stake(stakeID)
        stake.bounty = bountyAddress.toHexString()
        stake.id = stakeID
        stake.broker = brokerAddress.toHexString()
    }
    stake.date = event.block.timestamp
    stake.amount = event.params.totalWei
    stake.allocatedWei = event.params.allocatedWei
    stake.save()
}

export function handleBountyUpdated(event: BountyUpdate): void {
    // log.info('handleBountyUpdated: sidechainaddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    log.info('handleBountyUpdated: totalStakeWei={} unallocatedWei={} projectedInsolvencyTime={} brokerCount={} isRunning={}', [
        event.params.totalStakeWei.toString(),
        event.params.unallocatedWei.toString(),
        event.params.projectedInsolvencyTime.toString(),
        event.params.brokerCount.toString(),
        event.params.isRunning.toString()
    ])
    let bountyAddress = event.address
    let bounty = Bounty.load(bountyAddress.toHexString())
    bounty!.totalStakedWei = event.params.totalStakeWei
    bounty!.unallocatedWei = event.params.unallocatedWei
    bounty!.projectedInsolvency = event.params.projectedInsolvencyTime
    bounty!.brokerCount = event.params.brokerCount.toI32()
    bounty!.isRunning = event.params.isRunning
    bounty!.save()
}
