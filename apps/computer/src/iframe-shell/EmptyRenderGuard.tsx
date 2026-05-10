import {
	createElement,
	useEffect,
	useRef,
	useState,
	type ComponentType,
} from "react";

interface EmptyRenderGuardProps {
	Component: ComponentType;
}

const VISIBLE_SELECTOR =
	"svg,canvas,img,iframe,table,button,input,select,textarea,a,[role]";

export function hasVisibleAppletContent(element: HTMLElement): boolean {
	if (element.textContent?.trim()) return true;
	return element.querySelector(VISIBLE_SELECTOR) !== null;
}

export function EmptyRenderGuard({ Component }: EmptyRenderGuardProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const [isEmpty, setIsEmpty] = useState(false);

	useEffect(() => {
		const element = contentRef.current;
		if (!element) return;

		const update = () => {
			setIsEmpty(!hasVisibleAppletContent(element));
		};

		update();
		const timeouts = [
			window.setTimeout(update, 50),
			window.setTimeout(update, 250),
			window.setTimeout(update, 750),
		];
		const observer = new MutationObserver(update);
		observer.observe(element, {
			childList: true,
			subtree: true,
			characterData: true,
		});

		return () => {
			for (const timeout of timeouts) window.clearTimeout(timeout);
			observer.disconnect();
		};
	}, []);

	return createElement(
		"div",
		{ className: "min-h-0" },
		createElement(
			"div",
			{
				ref: contentRef,
				"data-thinkwork-applet-content": "",
				className:
					"min-h-0 [&>*]:rounded-none [&>*>*]:rounded-none",
				style: {
					borderRadius: 0,
				},
			},
			createElement(Component),
		),
		isEmpty
			? createElement(
					"div",
					{
						className:
							"rounded-lg border border-dashed border-border bg-muted/40 p-6 text-sm text-muted-foreground",
					},
					"This app rendered no visible content.",
				)
			: null,
	);
}
