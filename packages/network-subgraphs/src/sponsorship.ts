import { BigInt, log } from '@graphprotocol/graph-ts'

import { Sponsorship, Operator, Stake, Flag, SponsorshipDailyBucket } from '../generated/schema'
import { StakeUpdate, SponsorshipUpdate, FlagUpdate, MetadataUpdate } from '../generated/templates/Sponsorship/Sponsorship'

export function handleStakeUpdated(event: StakeUpdate): void {
    log.info('handleStakeUpdated: operator={} totalStake={} allocation={}', [event.params.operator.toHexString(),
        event.params.stakedWei.toString(), event.params.allocatedWei.toString()])
    let sponsorshipAddress = event.address
    let operatorAddress = event.params.operator

    let stakeID = sponsorshipAddress.toHexString() + "-" + operatorAddress.toHexString()
    let stake = Stake.load(stakeID)
    if (stake === null) {
        stake = new Stake(stakeID)
        stake.sponsorship = sponsorshipAddress.toHexString()
        stake.id = stakeID
        stake.operator = operatorAddress.toHexString()
    }
    stake.date = event.block.timestamp
    stake.amount = event.params.stakedWei
    stake.allocatedWei = event.params.allocatedWei

    // link to pool
    let pool = Operator.load(event.params.operator.toHexString())
    if (pool !== null) {
        log.info('handleStakeUpdated: updating pool pool={} stake={}', [pool.id, stake.id])
        // pool.stakes.push(stakeID)
        stake.pool = pool.id
    }
    stake.save()
}

export function handleSponsorshipUpdated(event: SponsorshipUpdate): void {
    // log.info('handleSponsorshipUpdated: sidechainaddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    log.info('handleSponsorshipUpdated: totalStakeWei={} unallocatedWei={} operatorCount={} isRunning={}', [
        event.params.totalStakeWei.toString(),
        event.params.unallocatedWei.toString(),
        event.params.operatorCount.toString(),
        event.params.isRunning.toString()
    ])
    let sponsorshipAddress = event.address
    let sponsorship = Sponsorship.load(sponsorshipAddress.toHexString())
    sponsorship!.totalStakedWei = event.params.totalStakeWei
    sponsorship!.unallocatedWei = event.params.unallocatedWei
    sponsorship!.operatorCount = event.params.operatorCount.toI32()
    sponsorship!.isRunning = event.params.isRunning
    sponsorship!.save()

    // update SponsorshipDailyBucket
    let date = new Date(event.block.timestamp.toI32() * 1000)
    date.setUTCHours(0)
    date.setUTCMinutes(0)
    date.setUTCSeconds(0)
    date.setUTCMilliseconds(0)
    //datestring in yyyy-mm-dd format
    let dateString = date.toISOString().split('T')[0]
    let statId = sponsorshipAddress.toHexString() + "-" + dateString
    let stat = SponsorshipDailyBucket.load(statId)
    if (stat === null) {
        log.info("handleSponsorshipUpdated: creating new stat statId={}", [statId])
        stat = new SponsorshipDailyBucket(statId)
        stat.id = statId
        stat.sponsorship = sponsorshipAddress.toHexString()
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
    stat.operatorCount = event.params.operatorCount.toI32()
    stat.save()
}

export function handleFlagUpdate(event: FlagUpdate): void {
    log.info('handleFlagUpdate: flagger={} target={} targetCommittedStake={} result={}',
        [event.params.flagger.toHexString(),
            event.params.target.toHexString(),
            event.params.targetCommittedStake.toString(),
            event.params.result.toString()])
    let sponsorshipAddress = event.address
    let flagID = sponsorshipAddress.toHexString() + "-" + event.params.target.toHexString()
    let flag = Flag.load(flagID)
    if (flag === null) {
        flag = new Flag(flagID)
        flag.id = flagID
        flag.sponsorship = sponsorshipAddress.toHexString()
        flag.target = event.params.target.toHexString()
    }
    flag.flagger = event.params.flagger.toHexString()
    flag.targetSlashAmount = event.params.targetCommittedStake
    flag.result = event.params.result
    flag.save()
}

export function handleMetadataUpdate(event: MetadataUpdate): void {
    log.info('handleMetadataUpdate: metadata={}', [event.params.metadata])
    let sponsorshipAddress = event.address
    let sponsorship = Sponsorship.load(sponsorshipAddress.toHexString())
    sponsorship!.metadata = event.params.metadata
    sponsorship!.save()
}