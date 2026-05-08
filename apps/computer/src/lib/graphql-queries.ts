import { gql } from "@urql/core";

/**
 * Plain `gql` template literals — apps/computer Phase 1 deliberately skips
 * the full graphql-codegen pipeline that admin uses. With only three
 * operations there's no benefit to typed document nodes yet; codegen lands
 * in a future slice when query count grows.
 */

export const MyComputerQuery = gql`
  query MyComputer {
    myComputer {
      id
      name
    }
  }
`;

export const ComputerThreadsQuery = gql`
  query ComputerThreads($tenantId: ID!, $computerId: ID!, $limit: Int) {
    threads(tenantId: $tenantId, computerId: $computerId, limit: $limit) {
      id
      number
      identifier
      title
      status
      channel
      createdAt
      updatedAt
    }
  }
`;

export const CreateThreadMutation = gql`
  mutation CreateThread($input: CreateThreadInput!) {
    createThread(input: $input) {
      id
      number
      identifier
      title
      status
      channel
      createdAt
    }
  }
`;
