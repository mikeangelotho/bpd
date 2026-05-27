import { type Component, createMemo } from 'solid-js';
import { marked } from 'marked';

// Configure marked for our use case
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface Props {
  content: string;
}

export const Markdown: Component<Props> = (props) => {
  const html = createMemo(() => {
    if (!props.content) return '';
    return marked.parse(props.content, { async: false }) as string;
  });

  return <div class="md" innerHTML={html()} />;
};
