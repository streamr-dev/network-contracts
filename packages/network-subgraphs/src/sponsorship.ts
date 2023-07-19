import { log, BigInt } from '@graphprotocol/graph-ts'

import { Sponsorship, Stake, Flag, SponsorshipDailyBucket, SlashingEvent, StakingEvent, Stream } from '../generated/schema'
import { StakeUpdate, SponsorshipUpdate, FlagUpdate, ProjectedInsolvencyUpdate, OperatorSlashed } from '../generated/templates/Sponsorship/Sponsorship'
import { updateOrCreateSponsorshipDailyBucket, getBucketStartDate } from './helpers'

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
    // let operator = Operator.load(event.params.operator.toHexString())
    // if (operator !== null) {
    //     log.info('handleStakeUpdated: updating pool pool={} stake={}', [operator.id, stake.id])
    //     stake.operator = operator.id
    // }
    stake.save()

    // also save StakingEvent
    let stakingEvent = new StakingEvent(sponsorshipAddress.toHexString() + "-" + event.transaction.hash.toHexString())
    stakingEvent.sponsorship = sponsorshipAddress.toHexString()
    stakingEvent.operator = operatorAddress.toHexString()
    stakingEvent.date = event.block.timestamp
    stakingEvent.amount = event.params.stakedWei
    stakingEvent.save()

    // let sponsorship = Sponsorship.load(sponsorshipAddress.toHexString())
    // if (sponsorship != null) {
    //     stakingEvent.sponsorship = sponsorship.id
    //     stakingEvent.save()
    // }
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
    if (sponsorship && sponsorship.totalPayoutWeiPerSec && sponsorship.totalStakedWei.gt(BigInt.fromI32(0))) {
        sponsorship.spotAPY = sponsorship.totalPayoutWeiPerSec.times(BigInt.fromI32(60 * 60 * 24 * 365)).div(sponsorship.totalStakedWei)
    }

    sponsorship!.save()

    // update SponsorshipDailyBucket
    updateOrCreateSponsorshipDailyBucket(sponsorshipAddress.toHexString(),
        event.block.timestamp,
        event.params.totalStakeWei,
        event.params.unallocatedWei,
        event.params.operatorCount.toI32(),
        null)
}

export function handleProjectedInsolvencyUpdate(event: ProjectedInsolvencyUpdate): void {
    log.info('handleProjectedInsolvencyUpdate: sidechainaddress={} projectedInsolvency={}',
        [event.address.toHexString(), event.params.projectedInsolvencyTimestamp.toString()])
    let sponsorshipAddress = event.address
    let sponsorship = Sponsorship.load(sponsorshipAddress.toHexString())
    sponsorship!.projectedInsolvency = event.params.projectedInsolvencyTimestamp
    sponsorship!.save()

    // update SponsorshipDailyBucket
    let sponsorshipId = event.address.toHexString() + "-" + getBucketStartDate(event.block.timestamp).toString()
    let sponsorshipDailyBucket = SponsorshipDailyBucket.load(sponsorshipId)
    if (sponsorshipDailyBucket !== null) {
        sponsorshipDailyBucket.projectedInsolvency = event.params.projectedInsolvencyTimestamp
        sponsorshipDailyBucket.save()
    }
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

export function handleOperatorSlashed(event: OperatorSlashed): void {
    log.info('handleOperatorSlashed: operator={} slashedAmount={}',
        [event.params.operator.toHexString(),
            event.params.amountWei.toString()
        ])
    let sponsorshipAddress = event.address
    let operatorAddress = event.params.operator

    let slashID = sponsorshipAddress.toHexString() + "-" + event.transaction.hash.toHexString()
    let slashingEvent = new SlashingEvent(slashID)
    slashingEvent.sponsorship = sponsorshipAddress.toHexString()
    slashingEvent.operator = operatorAddress.toHexString()
    slashingEvent.date = event.block.timestamp
    slashingEvent.amount = event.params.amountWei
    slashingEvent.save()
}