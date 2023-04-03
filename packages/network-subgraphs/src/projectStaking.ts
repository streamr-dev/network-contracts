import { log } from '@graphprotocol/graph-ts'
import {
    Stake,
    Unstake,
} from '../generated/ProjectStakingV1/ProjectStakingV1'
import { loadOrCreateProject, loadOrCreateProjectStake, loadOrCreateProjectStakingBucket } from './helpers'

export function handleStake(event: Stake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    log.info('handleStake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId, event.params.totalStake)

    const projectStake = loadOrCreateProjectStake(projectId, event.params.user)
    projectStake.userStake = projectStake.userStake.plus(event.params.amount)
    projectStake.save()
    
    const bucket =  loadOrCreateProjectStakingBucket(projectId, event.block.timestamp)
    bucket.stakeChange = bucket.stakeChange.plus(event.params.amount)
    bucket.save()

    project.score = project.score.plus(event.params.amount)
    project.save()
}

export function handleUnstake(event: Unstake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    log.info('handleUnstake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId, event.params.totalStake)

    const projectStake = loadOrCreateProjectStake(projectId, event.params.user)
    projectStake.userStake = projectStake.userStake.minus(event.params.amount)
    projectStake.save()
    
    const bucket =  loadOrCreateProjectStakingBucket(projectId, event.block.timestamp)
    log.info('handleUnstake: bucketId={}', [bucket.id])
    bucket.stakeChange = bucket.stakeChange.minus(event.params.amount)
    bucket.save()

    project.score = project.score.minus(event.params.amount)
    project.save()
}
