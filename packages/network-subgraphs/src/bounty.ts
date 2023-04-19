import { BigInt, log } from '@graphprotocol/graph-ts'

import { Bounty, BrokerPool, BountyStake, Flag, BountyDailyBucket } from '../generated/schema'
import { StakeUpdate, BountyUpdate, FlagUpdate, MetadataUpdate } from '../generated/templates/Bounty/Bounty'

export function handleStakeUpdated(event: StakeUpdate): void {
    log.info('handleStakeUpdated: broker={} totalStake={} allocation={}', [event.params.broker.toHexString(),
        event.params.stakedWei.toString(), event.params.allocatedWei.toString()])
    let bountyAddress = event.address
    let brokerAddress = event.params.broker

    let stakeID = bountyAddress.toHexString() + "-" + brokerAddress.toHexString()
    let stake = BountyStake.load(stakeID)
    if (stake === null) {
        stake = new BountyStake(stakeID)
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
    log.info('handleBountyUpdated: totalStakeWei={} unallocatedWei={} brokerCount={} isRunning={}', [
        event.params.totalStakeWei.toString(),
        event.params.unallocatedWei.toString(),
        event.params.brokerCount.toString(),
        event.params.isRunning.toString()
    ])
    let bountyAddress = event.address
    let bounty = Bounty.load(bountyAddress.toHexString())
    bounty!.totalStakedWei = event.params.totalStakeWei
    bounty!.unallocatedWei = event.params.unallocatedWei
    bounty!.brokerCount = event.params.brokerCount.toI32()
    bounty!.isRunning = event.params.isRunning
    bounty!.save()

    // update BountyDailyBucket
    let date = new Date(event.block.timestamp.toI32() * 1000)
    date.setUTCHours(0)
    date.setUTCMinutes(0)
    date.setUTCSeconds(0)
    date.setUTCMilliseconds(0)
    //datestring in yyyy-mm-dd format
    let dateString = date.toISOString().split('T')[0]
    let statId = bountyAddress.toHexString() + "-" + dateString
    let stat = BountyDailyBucket.load(statId)
    if (stat === null) {
        log.info("handleBountyUpdated: creating new stat statId={}", [statId])
        stat = new BountyDailyBucket(statId)
        stat.id = statId
        stat.bounty = bountyAddress.toHexString()
        stat.date = new BigInt(i32(date.getTime()))
        stat.totalStakedWei = event.params.totalStakeWei
        stat.unallocatedWei = event.params.unallocatedWei
        stat.spotAPY = new BigInt(0)
        stat.totalPayoutsCumulative = new BigInt(0)
    } else {
        stat.totalStakedWei = stat.totalStakedWei.plus(event.params.totalStakeWei)
        stat.unallocatedWei = stat.unallocatedWei.plus(event.params.unallocatedWei)
        // stat.totalPayoutsCumulative = stat.totalPayoutsCumulative.plus(event.params.totalPayoutsCumulative)
    }
    stat.brokerCount = event.params.brokerCount.toI32()
    stat.save()
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

export function handleMetadataUpdate(event: MetadataUpdate): void {
    log.info('handleMetadataUpdate: metadata={}', [event.params.metadata])
    let bountyAddress = event.address
    let bounty = Bounty.load(bountyAddress.toHexString())
    bounty!.metadata = event.params.metadata
    bounty!.save()
}