import { log, BigInt } from '@graphprotocol/graph-ts'

import {
    StakeUpdate,
    SponsorshipUpdate,
    FlagUpdate,
    ProjectedInsolvencyUpdate,
    OperatorSlashed,
    SponsorshipReceived
} from '../generated/templates/Sponsorship/Sponsorship'
import { Sponsorship, Stake, Flag, SlashingEvent, StakingEvent, SponsoringEvent, Operator } from '../generated/schema'
import { loadOrCreateSponsorshipDailyBucket } from './helpers'

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
}

export function handleSponsorshipUpdated(event: SponsorshipUpdate): void {
    log.info('handleSponsorshipUpdated: totalStakeWei={} unallocatedWei={} operatorCount={} isRunning={}', [
        event.params.totalStakeWei.toString(), event.params.unallocatedWei.toString(),
        event.params.operatorCount.toString(), event.params.isRunning.toString()
    ])

    let sponsorshipAddress = event.address.toHexString()
    let sponsorship = Sponsorship.load(sponsorshipAddress)!

    // TODO: should !isRunning mean APY is zero?
    let spotAPY = BigInt.zero()
    if (sponsorship.totalPayoutWeiPerSec > BigInt.zero() && sponsorship.totalStakedWei.gt(BigInt.zero())) {
        spotAPY = sponsorship.totalPayoutWeiPerSec.times(BigInt.fromI32(60 * 60 * 24 * 365)).div(sponsorship.totalStakedWei)
    }

    sponsorship.totalStakedWei = event.params.totalStakeWei
    sponsorship.unallocatedWei = event.params.unallocatedWei
    sponsorship.operatorCount = event.params.operatorCount.toI32()
    sponsorship.isRunning = event.params.isRunning
    sponsorship.spotAPY = spotAPY
    sponsorship.save()

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorshipAddress, event.block.timestamp)
    bucket.totalStakedWei = event.params.totalStakeWei
    bucket.unallocatedWei = event.params.unallocatedWei
    bucket.operatorCount = event.params.operatorCount.toI32()
    bucket.spotAPY = spotAPY
    bucket.save()
}

export function handleProjectedInsolvencyUpdate(event: ProjectedInsolvencyUpdate): void {
    log.info('handleProjectedInsolvencyUpdate: sidechainaddress={} projectedInsolvency={}',
        [event.address.toHexString(), event.params.projectedInsolvencyTimestamp.toString()])

    let sponsorshipAddress = event.address.toHexString()
    let sponsorship = Sponsorship.load(sponsorshipAddress)!
    sponsorship.projectedInsolvency = event.params.projectedInsolvencyTimestamp
    sponsorship.save()

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorshipAddress, event.block.timestamp)
    bucket.projectedInsolvency = event.params.projectedInsolvencyTimestamp
    bucket.save()
}

export function handleFlagUpdate(event: FlagUpdate): void {
    log.info('handleFlagUpdate: flagger={} target={} targetCommittedStake={} result={}, flagMetadata={}',
        [event.params.flagger.toHexString(),
            event.params.target.toHexString(),
            event.params.targetCommittedStake.toString(),
            event.params.result.toString(),
            event.params.flagMetadata // not indexed as there is no use case for it yet, but could be useful
        ])
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

    // update Operator
    let operator = Operator.load(operatorAddress.toHexString())
    if (operator !== null) {
        operator.slashingsCount = operator.slashingsCount + 1
        operator.save()
    }
}

export function handleSponsorshipReceived(event: SponsorshipReceived): void {
    log.info('handleSponsorshipReceived: sponsor={} amount={}', [event.params.sponsor.toHexString(),
        event.params.amount.toString()
    ])
    let sponsorship = Sponsorship.load(event.address.toHexString())
    sponsorship!.cumulativeSponsoring = sponsorship!.cumulativeSponsoring.plus(event.params.amount)
    sponsorship!.save()

    let sponsoringEvent = new SponsoringEvent(event.address.toHexString() + event.transaction.hash.toHexString())
    sponsoringEvent.sponsorship = event.address.toHexString()
    sponsoringEvent.sponsor = event.params.sponsor.toHexString()
    sponsoringEvent.date = event.block.timestamp
    sponsoringEvent.amount = event.params.amount
    sponsoringEvent.save()
}
