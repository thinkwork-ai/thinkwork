import { gql } from "urql";

export const MeQuery = gql`
  query Me {
    me {
      id
      email
      name
      tenantId
    }
  }
`;

export const ThreadQuery = gql`
  query Thread($id: ID!) {
    thread(id: $id) {
      id
      title
      createdAt
      updatedAt
    }
  }
`;

export const MessagesQuery = gql`
  query Messages($threadId: ID!) {
    messages(threadId: $threadId) {
      id
      threadId
      authorId
      role
      kind
      content
      createdAt
    }
  }
`;

export const CreateThreadMutation = gql`
  mutation CreateThread($input: CreateThreadInput!) {
    createThread(input: $input) {
      id
      title
      createdAt
      updatedAt
    }
  }
`;

export const SendMessageMutation = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      id
      threadId
      authorId
      role
      kind
      content
      createdAt
    }
  }
`;
