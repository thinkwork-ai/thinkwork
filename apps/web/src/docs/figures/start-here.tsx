/**
 * Figures for the Start here section (THINK-695).
 *
 * Deliberately drawn at USER altitude: the picture answers "what is on the
 * other side of the message I just sent", so it names things a person can
 * see in the app — a Space, a connector, memory — and no infrastructure.
 */
import { Diagram, DgArrow, DgBox, DgLabel } from "../diagrams";

/**
 * You ↔ agent ↔ what the agent draws on ↔ what comes back. The one picture
 * Getting started leans on; every noun in it has a glossary entry.
 */
export function AgentAtWorkDiagram() {
  return (
    <Diagram
      title="How a request reaches the agent and what it draws on"
      viewBox="0 0 620 500"
      caption={
        <>
          One turn, end to end. You ask from whichever client is in front of
          you; the agent answers using three things it can reach — what it
          remembers, the systems it is connected to, and the Space the thread
          lives in — and hands back more than text.
        </>
      }
    >
      <DgLabel x={24} y={26} text="You" />
      <DgBox
        x={170}
        y={36}
        w={280}
        h={54}
        tone="consumer"
        title="You"
        sub="web app · mobile app · Slack"
      />

      <DgArrow d="M 310 90 V 130" label="you ask" labelAt={[310, 110]} />

      <DgLabel x={24} y={158} text="The agent" />
      <DgBox
        x={170}
        y={168}
        w={280}
        h={62}
        tone="compute"
        title="Your agent"
        sub="its instructions, skills and connectors"
      />

      <DgArrow d="M 310 230 V 272 H 133 V 298" />
      <DgArrow d="M 310 230 V 298" />
      <DgArrow d="M 310 230 V 272 H 487 V 298" />

      <DgLabel x={24} y={292} text="What it draws on" />
      <DgBox
        x={48}
        y={302}
        w={170}
        h={64}
        tone="storage"
        title="Memory"
        sub="what it already knows"
      />
      <DgBox
        x={225}
        y={302}
        w={170}
        h={64}
        tone="source"
        title="Connectors"
        sub="Slack, GitHub, Google"
      />
      <DgBox
        x={402}
        y={302}
        w={170}
        h={64}
        tone="graph"
        title="The Space"
        sub="files, threads, work"
      />

      <DgArrow d="M 133 366 V 400 H 250 V 426" />
      <DgArrow d="M 310 366 V 426" />
      <DgArrow d="M 487 366 V 400 H 370 V 426" />

      <DgLabel x={24} y={420} text="What comes back" />
      <DgBox
        x={170}
        y={430}
        w={280}
        h={56}
        title="An answer, and often more"
        sub="charts, artifacts, work items"
      />
    </Diagram>
  );
}
