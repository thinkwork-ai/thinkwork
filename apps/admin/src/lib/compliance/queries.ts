import { graphql } from "@/gql";

export const ComplianceEventsListQuery = graphql(`
  query ComplianceEventsList(
    $filter: ComplianceEventFilter
    $after: String
    $first: Int
  ) {
    complianceEvents(filter: $filter, after: $after, first: $first) {
      edges {
        node {
          eventId
          tenantId
          occurredAt
          recordedAt
          actor
          actorType
          source
          eventType
          eventHash
          prevHash
          anchorStatus {
            state
            cadenceId
            anchoredRecordedAt
            nextCadenceWithinMinutes
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

export const ComplianceEventDetailQuery = graphql(`
  query ComplianceEventDetail($eventId: ID!) {
    complianceEvent(eventId: $eventId) {
      eventId
      tenantId
      occurredAt
      recordedAt
      actor
      actorType
      source
      eventType
      eventHash
      prevHash
      payload
      anchorStatus {
        state
        cadenceId
        anchoredRecordedAt
        nextCadenceWithinMinutes
      }
    }
  }
`);

export const ComplianceEventByHashQuery = graphql(`
  query ComplianceEventByHash($eventHash: String!) {
    complianceEventByHash(eventHash: $eventHash) {
      eventId
      tenantId
      occurredAt
      recordedAt
      actor
      actorType
      source
      eventType
      eventHash
      prevHash
      anchorStatus {
        state
        cadenceId
        anchoredRecordedAt
        nextCadenceWithinMinutes
      }
    }
  }
`);

export const ComplianceTenantsQuery = graphql(`
  query ComplianceTenants {
    complianceTenants
  }
`);

export const ComplianceOperatorCheckQuery = graphql(`
  query ComplianceOperatorCheck {
    complianceOperatorCheck {
      isOperator
      allowlistConfigured
    }
  }
`);
