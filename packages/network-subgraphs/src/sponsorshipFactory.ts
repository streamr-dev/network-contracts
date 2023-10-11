import { BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'

import { NewSponsorship } from '../generated/SponsorshipFactory/SponsorshipFactory'
import { Sponsorship, Stream } from '../generated/schema'
import { Sponsorship as SponsorshipTemplate } from '../generated/templates'
import { loadOrCreateSponsorshipDailyBucket } from './helpers'

export function handleNewSponsorship(event: NewSponsorship): void {
    let sponsorshipContractAddress = event.params.sponsorshipContract.toHexString()
    let creator = event.params.creator.toHexString()
    log.info('handleNewSponsorship: blockNumber={} sponsorshipContract={} policies={} policyParams={} creator={}',
        [event.block.number.toString(), sponsorshipContractAddress, event.params.policies.toString(), event.params.policyParams.toString(), creator]
    )

    let sponsorship = new Sponsorship(sponsorshipContractAddress)
    sponsorship.totalStakedWei = BigInt.zero()
    sponsorship.remainingWei = BigInt.zero()
    sponsorship.spotAPY = BigDecimal.zero()
    sponsorship.projectedInsolvency = BigInt.zero()
    sponsorship.operatorCount = 0
    sponsorship.isRunning = false
    sponsorship.metadata = event.params.metadata
    sponsorship.totalPayoutWeiPerSec = event.params.policyParams[0]
    sponsorship.minimumStakingPeriodSeconds = event.params.policyParams[1]
    sponsorship.creator = creator
    sponsorship.cumulativeSponsoring = BigInt.zero()

    // The standard ordering is: allocation, leave, kick, join policies
    // "Operator-only join policy" is always set, so we check if we have 5 policies,
    //   and in that case we assume the 4th policy is the "max-operators join policy"
    if (event.params.policies.length == 5) {
        sponsorship.maxOperators = event.params.policyParams[3].toI32()
    }
    sponsorship.save()

    // try to load stream entity
    let stream = Stream.load(event.params.streamId.toString())
    if (stream != null) {
        sponsorship.stream = stream.id
        sponsorship.save()
    }

    // start listening to events from the newly created Sponsorship contract
    SponsorshipTemplate.create(event.params.sponsorshipContract)

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorshipContractAddress, event.block.timestamp)
    bucket.save()
}
