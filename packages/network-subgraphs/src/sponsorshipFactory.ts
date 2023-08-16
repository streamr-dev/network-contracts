import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewSponsorship } from '../generated/SponsorshipFactory/SponsorshipFactory'
import { Sponsorship, Stream } from '../generated/schema'
import { Sponsorship as SponsorshipTemplate } from '../generated/templates'
import { loadOrCreateSponsorshipDailyBucket } from './helpers'

export function handleNewSponsorship(event: NewSponsorship): void {
    let sponsorshipContractAddress = event.params.sponsorshipContract.toHexString()
    let creator = event.params.creator.toHexString()
    log.info('handleNewSponsorship: blockNumber={} sponsorshipContract={} creator={}',
        [event.block.number.toString(), sponsorshipContractAddress, creator]
    )

    let sponsorship = new Sponsorship(sponsorshipContractAddress)
    sponsorship.totalStakedWei = BigInt.zero()
    sponsorship.unallocatedWei = BigInt.zero()
    sponsorship.spotAPY = BigInt.zero()
    sponsorship.projectedInsolvency = BigInt.zero()
    sponsorship.operatorCount = 0
    sponsorship.isRunning = false
    sponsorship.metadata = event.params.metadata
    sponsorship.totalPayoutWeiPerSec = event.params.totalPayoutWeiPerSec
    sponsorship.creator = creator
    sponsorship.cumulativeSponsoring = BigInt.zero()
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
