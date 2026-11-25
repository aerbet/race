import dispatcher from './dispatcher.json';

export interface StoryChoice {
  text: string;
  next: string;
}
export interface StoryNode {
  text: string;
  end?: boolean;
  choices: StoryChoice[];
}
export interface Story {
  id: string;
  speaker: string;
  start: string;
  reward: number;
  nodes: Record<string, StoryNode>;
}

export const DISPATCHER = dispatcher as Story;

/** Переход по выбору; null — такого выбора в узле нет. */
export function storyNext(story: Story, node: string, choice: number): string | null {
  const n = story.nodes[node];
  const c = n?.choices[choice];
  return c && story.nodes[c.next] ? c.next : null;
}
