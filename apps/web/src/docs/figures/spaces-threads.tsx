/**
 * Figures for the Spaces & threads section (THINK-697).
 *
 * Two pictures that the kit's FlowChain cannot draw:
 *  - SpaceCompositionDiagram — a Space is not a step in a sequence, it is a
 *    layer wrapped around the one Enterprise Agent. That needs a band with four
 *    parallel parts inside it, not a chain.
 *  - WorkArrivesDiagram — four independent entry points converging on one
 *    thread is a genuine fan-in; drawn as elbowed edges meeting one box.
 *
 * Both follow the house rules in ../diagrams.tsx: fixed viewBox, tone accents
 * only, 13/11/10px type.
 */
import { Diagram, DgArrow, DgBox, DgChip, DgGroup, DgLabel } from "../diagrams";

/**
 * What a Space is made of, and what it sits on top of. The point the picture
 * has to land: there is one agent per tenant, and the Space is the layer that
 * makes that agent behave like a Support agent or a Finance agent.
 */
export function SpaceCompositionDiagram() {
  const parts: {
    x: number;
    title: string;
    sub: string;
    tone: "consumer" | "storage" | "source" | "graph";
    chips: string[];
  }[] = [
    {
      x: 40,
      title: "Members",
      sub: "who can open it",
      tone: "consumer",
      chips: ["public", "private"],
    },
    {
      x: 204,
      title: "Space files",
      sub: "local procedures",
      tone: "storage",
      chips: ["SPACE.md", "docs/"],
    },
    {
      x: 368,
      title: "Triggers",
      sub: "how work arrives",
      tone: "source",
      chips: ["email", "schedule"],
    },
    {
      x: 532,
      title: "Threads",
      sub: "what happened here",
      tone: "graph",
      chips: ["CHAT-1962"],
    },
  ];

  return (
    <Diagram
      title="A Space layered over the Enterprise Agent: members, files, triggers and threads"
      viewBox="0 0 720 430"
      caption="One agent per tenant. A Space does not clone it — it wraps it, so the same agent arrives at a Support turn and a Finance turn with different local context."
    >
      <DgLabel x={40} y={24} text="Tenant" />
      <DgBox
        x={40}
        y={34}
        w={640}
        h={62}
        title="The Enterprise Agent"
        sub="your company's one agent — instructions, skills, connectors"
        tone="compute"
      />
      <DgArrow d="M 360 96 L 360 146" label="shaped by" labelAt={[360, 121]} />

      <DgGroup x={24} y={150} w={672} h={172} label="Space — Support" />
      {parts.map((part) => (
        <g key={part.title}>
          <DgBox
            x={part.x}
            y={186}
            w={148}
            h={112}
            title={part.title}
            sub={part.sub}
            tone={part.tone}
            align="top"
          />
          {part.chips.map((chip, index) => (
            <DgChip
              key={chip}
              x={part.x + 14}
              y={242 + index * 24}
              label={chip}
              tone={part.tone}
            />
          ))}
        </g>
      ))}

      <DgArrow d="M 360 322 L 360 360" label="one turn" labelAt={[360, 341]} />
      <DgBox
        x={168}
        y={362}
        w={384}
        h={58}
        title="What the agent works from, this turn"
        sub="the agent's baseline plus this Space — not the others"
      />
    </Diagram>
  );
}

/**
 * The four ways work reaches a Space. Deliberately a fan-in: the whole point
 * is that four unrelated entry points land in the same container, and the
 * only difference afterwards is the channel stamped on the thread.
 */
export function WorkArrivesDiagram() {
  const sources: {
    x: number;
    title: string;
    sub: string;
    /** Where its edge meets the thread box. */
    into: number;
  }[] = [
    { x: 24, title: "Chat", sub: "you type in the app", into: 225 },
    { x: 192, title: "Email", sub: "to the Space address", into: 315 },
    { x: 360, title: "Schedule", sub: "rate or cron", into: 405 },
    { x: 528, title: "Webhook", sub: "an external POST", into: 495 },
  ];

  return (
    <Diagram
      title="Chat, email, schedule and webhook converging on one thread in a Space"
      viewBox="0 0 720 356"
      caption="Four entry points, one container. Whatever started the work, it becomes a thread in a Space and the agent runs with that Space's context."
    >
      <DgLabel x={24} y={20} text="How work arrives" />
      {sources.map((source) => (
        <g key={source.title}>
          <DgBox
            x={source.x}
            y={30}
            w={168}
            h={56}
            title={source.title}
            sub={source.sub}
            tone="source"
          />
          <DgArrow
            d={`M ${source.x + 84} 86 L ${source.x + 84} 126 L ${source.into} 126 L ${source.into} 154`}
          />
        </g>
      ))}

      <DgBox
        x={180}
        y={156}
        w={360}
        h={62}
        title="A thread in the Space"
        sub="the channel is recorded on the thread"
        tone="graph"
      />
      <DgArrow
        d="M 360 218 L 360 258"
        label="agent turn"
        labelAt={[360, 238]}
      />
      <DgBox
        x={180}
        y={260}
        w={360}
        h={62}
        title="The agent runs in this Space"
        sub="its files, its memory, its members"
        tone="compute"
      />
    </Diagram>
  );
}
