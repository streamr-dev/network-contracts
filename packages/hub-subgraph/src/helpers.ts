import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { Project } from '../generated/schema'

/**
 * Helper function to load a project or create a project with default values. It will probably silence some errors.
 * @dev toHexString() will automatically lowercase the projectId
 */
export function loadOrCreateProject(projectId: Bytes): Project {
    let project = Project.load(projectId.toHexString())
    if (project == null) {
        project = new Project(projectId.toHexString())
        project.domainIds = []
        project.minimumSubscriptionSeconds = BigInt.fromI32(0)
        project.metadata = ""
        project.streams = []
        project.createdAt = BigInt.fromI32(0)
        project.counter = 0
        project.score = BigInt.fromI32(0)
    }
    return project
}
