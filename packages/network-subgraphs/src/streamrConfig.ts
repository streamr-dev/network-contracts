import { BigInt, log } from '@graphprotocol/graph-ts'
import { ConfigChanged } from '../generated/StreamrConfig/StreamrConfig'
import { Network } from '../generated/schema'
import { loadOrCreateNetwork } from './helpers'

export function handleConfigChanged(event: ConfigChanged): void {
    let streamrConfigAddress = event.address.toHexString()
    let key = event.params.key.toString()
    let newValue = event.params.newValue
    let newAddress = event.params.newAddress.toHexString()

    log.info('handleConfigChanged: streamrConfigAddress={} key={} newValue={} newAddress={} blockNumber={}', 
        [streamrConfigAddress, key, newValue.toString(), newAddress, event.block.number.toString()])

    let network = loadOrCreateNetwork()
    if (key == "slashingFraction") { network.slashingFraction = newValue }
    else if (key == "earlyLeaverPenaltyWei") { network.earlyLeaverPenaltyWei = newValue }
    else if (key == "minimumSelfDelegationFraction") { network.minimumSelfDelegationFraction = newValue }
    else if (key == "minimumDelegationWei") { network.minimumDelegationWei = newValue }
    else if (key == "maxPenaltyPeriodSeconds") { network.maxPenaltyPeriodSeconds = newValue }
    else if (key == "maxQueueSeconds") { network.maxQueueSeconds = newValue }
    else if (key == "maxAllowedEarningsFraction") { network.maxAllowedEarningsFraction = newValue }
    else if (key == "fishermanRewardFraction") { network.fishermanRewardFraction = newValue }
    else if (key == "protocolFeeFraction") { network.protocolFeeFraction = newValue }
    else if (key == "protocolFeeBeneficiary") { network.protocolFeeBeneficiary = newAddress }
    else if (key == "minEligibleVoterAge") { network.minEligibleVoterAge = newValue }
    else if (key == "minEligibleVoterFractionOfAllStake") { network.minEligibleVoterFractionOfAllStake = newValue }
    else if (key == "flagReviewerCount") { network.flagReviewerCount = newValue }
    else if (key == "flagReviewerRewardWei") { network.flagReviewerRewardWei = newValue }
    else if (key == "flaggerRewardWei") { network.flaggerRewardWei = newValue }
    else if (key == "flagReviewerSelectionIterations") { network.flagReviewerSelectionIterations = newValue }
    else if (key == "flagStakeWei") { network.flagStakeWei = newValue }
    else if (key == "reviewPeriodSeconds") { network.reviewPeriodSeconds = newValue }
    else if (key == "votingPeriodSeconds") { network.votingPeriodSeconds = newValue }
    else if (key == "flagProtectionSeconds") { network.flagProtectionSeconds = newValue }
    else if (key == "randomOracle") { network.randomOracle = newAddress }
    else if (key == "trustedForwarder") { network.trustedForwarder = newAddress }
    else if (key == "sponsorshipFactory") { network.sponsorshipFactory = newAddress }
    else if (key == "operatorFactory") { network.operatorFactory = newAddress }
    else if (key == "voterRegistry") { network.voterRegistry = newAddress }
    else if (key == "operatorContractOnlyJoinPolicy") { network.operatorContractOnlyJoinPolicy = newAddress }
    else if (key == "streamRegistryAddress") { network.streamRegistryAddress = newAddress }
    network.save()
}