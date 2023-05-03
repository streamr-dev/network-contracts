import { BigInt, log } from '@graphprotocol/graph-ts'

import { Sponsorship, Operator, Stake, Flag, SponsorshipDailyBucket } from '../generated/schema'
import { StakeUpdate, SponsorshipUpdate, FlagUpdate } from '../generated/templates/Sponsorship/Sponsorship'

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
        stake.operator = operatorAddress.toHexString()
    }
    stake.date = event.block.timestamp
    stake.amount = event.params.stakedWei
    stake.allocatedWei = event.params.allocatedWei

    // link to operator
    let operator = Operator.load(event.params.operator.toHexString())
    if (operator !== null) {
        log.info('handleStakeUpdated: updating pool pool={} stake={}', [operator.id, stake.id])
        stake.operator = operator.id
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
    let bucketId = sponsorshipAddress.toHexString() + "-" + dateString
    let bucket = SponsorshipDailyBucket.load(bucketId)
    if (bucket === null) {
        log.info("handleSponsorshipUpdated: creating new stat statId={}", [bucketId])
        bucket = new SponsorshipDailyBucket(bucketId)
        bucket.sponsorship = sponsorshipAddress.toHexString()
        bucket.date = BigInt.fromI32(i32(date.getTime() / 1000))
        bucket.totalStakedWei = event.params.totalStakeWei
        bucket.unallocatedWei = event.params.unallocatedWei
        bucket.projectedInsolvency = new BigInt(0)
        bucket.spotAPY = new BigInt(0)
        bucket.totalPayoutsCumulative = new BigInt(0)
    } else {
        bucket.totalStakedWei = bucket.totalStakedWei.plus(event.params.totalStakeWei)
        bucket.unallocatedWei = bucket.unallocatedWei.plus(event.params.unallocatedWei)
    }
    bucket.operatorCount = event.params.operatorCount.toI32()
    bucket.save()
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
        flag.sponsorship = sponsorshipAddress.toHexString()
        flag.target = event.params.target.toHexString()
    }
    flag.flagger = event.params.flagger.toHexString()
    flag.targetSlashAmount = event.params.targetCommittedStake
    flag.result = event.params.result
    flag.save()
}
