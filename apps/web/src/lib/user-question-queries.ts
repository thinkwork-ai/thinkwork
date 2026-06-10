import { graphql } from "@/gql";

// Typed graphql() operations for the ask_user_question HITL card
// (plan 2026-06-09-005 U8). Lives beside the other typed query modules
// (settings-queries.ts, skill-catalog-queries.ts) so codegen validates it.

export const AnswerUserQuestionMutation = graphql(`
  mutation AnswerUserQuestion($questionId: ID!, $answers: AWSJSON!) {
    answerUserQuestion(questionId: $questionId, answers: $answers) {
      id
      threadId
      messageId
      status
      answers
      answeredVia
      answeredBy
      answeredAt
    }
  }
`);
