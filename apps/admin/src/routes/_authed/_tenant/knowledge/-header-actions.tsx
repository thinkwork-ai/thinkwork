import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type KnowledgeHeaderActionSetter = Dispatch<
  SetStateAction<ReactNode | null>
>;

const KnowledgeHeaderActionContext =
  createContext<KnowledgeHeaderActionSetter | null>(null);

export const KnowledgeHeaderActionProvider =
  KnowledgeHeaderActionContext.Provider;

export function useKnowledgeHeaderAction() {
  return useContext(KnowledgeHeaderActionContext);
}
