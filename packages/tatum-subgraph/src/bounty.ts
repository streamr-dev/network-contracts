import { log } from '@graphprotocol/graph-ts'

import { Bounty, BrokerPool, Stake, Flag } from '../generated/schema'
import { StakeUpdate, BountyUpdate, FlagUpdate } from '../generated/templates/Bounty/Bounty'

export function handleStakeUpdated(event: StakeUpdate): void {
    log.info('handleStakeUpdated: broker={} totalStake={} allocation={}', [event.params.broker.toHexString(),
        event.params.stakedWei.toString(), event.params.allocatedWei.toString()])
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
    stake.amount = event.params.stakedWei
    stake.allocatedWei = event.params.allocatedWei

    // link to pool
    let pool = BrokerPool.load(event.params.broker.toHexString())
    if (pool !== null) {
        log.info('handleStakeUpdated: updating pool pool={} stake={}', [pool.id, stake.id])
        // pool.stakes.push(stakeID)
        stake.pool = pool.id
    }
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

export function handleFlagUpdate(event: FlagUpdate): void {
    log.info('handleFlagUpdate: flagger={} target={} targetCommittedStake={} result={}',
        [event.params.flagger.toHexString(),
            event.params.target.toHexString(),
            event.params.targetCommittedStake.toString(),
            event.params.result.toString()]) 
    let bountyAddress = event.address
    let flagID = bountyAddress.toHexString() + "-" + event.params.target.toHexString()
    let flag = Flag.load(flagID)
    if (flag === null) {
        flag = new Flag(flagID)
        flag.id = flagID
        flag.bounty = bountyAddress.toHexString()
        flag.target = event.params.target.toHexString()
    }
    flag.flagger = event.params.flagger.toHexString()
    flag.targetSlashAmount = event.params.targetCommittedStake
    flag.result = event.params.result
    flag.save()
}