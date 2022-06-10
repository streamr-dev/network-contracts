import { log } from '@graphprotocol/graph-ts'

import { Bounty, Stake } from '../generated/schema'
import { StakeUpdate, BountyUpdate } from '../generated/templates/Bounty/Bounty'

export function handleStakeUpdated(event: StakeUpdate): void {
    log.info('handleStakeUpdated: sidechainaddress={} allocation={}', [event.address.toHexString(),  event.params.allocatedWei.toString()])
    let bountyAddress = event.address
    let brokerAddress = event.params.broker
    let totalStake = event.params.totalWei

    let stakeID = bountyAddress.toHexString() + "-" + brokerAddress.toHexString()
    let stake = Stake.load(stakeID)
    if (stake === null) {
        stake = new Stake(stakeID)
        stake.bounty = bountyAddress.toHexString()
        stake.id = stakeID
        stake.broker = brokerAddress.toHexString()
    }
    stake.date = event.block.timestamp
    stake.amount = totalStake
    stake.allocatedWei = event.params.allocatedWei
    stake.save()
}

export function handleBountyUpdated(event: BountyUpdate): void {
    log.info('handleBountyUpdated: sidechainaddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    let bountyAddress = event.address
    let bounty = Bounty.load(bountyAddress.toHexString())
    bounty!.totalStakedWei = event.params.totalStakeWei
    bounty!.unallocatedWei = event.params.unallocatedWei
    bounty!.projectedInsolvency = event.params.projectedInsolvencyTime
    bounty!.memberCount = event.params.memberCount.toI32()
    bounty!.isRunning = event.params.isRunning
    bounty!.save()
}
