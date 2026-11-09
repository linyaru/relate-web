import { Box, Dialog, FilledButton, OutlinedButton, TextLink, Typography } from '@neo4j-ndl/react';
import { CypherEditor } from '@neo4j-cypher/react-codemirror';

import { useIsMobile } from '../hooks/useIsMobile';
import type { RecipeState } from '../hooks/useRecipeSession';
import { NOUNS, recipePageUrl, type RecipeLink } from '../lib/recipe-link';
import './cypher-editor.css';

interface Props {
  isOpen: boolean;
  link: RecipeLink;
  state: RecipeState;
  /** Why the last load stopped, if it did. */
  error: string | null;
  isRunning: boolean;
  canRun: boolean;
  onLoad: () => void;
  onDismiss: () => void;
}

// Shown instead of the welcome dialog when the page was opened from a
// cookbook step (#recipe=…&cell=…) or a whole recipe (#recipe=…, ADR-0134),
// or from a docs page's cell (#docs=…&cell=…) or the whole page (#docs=…).
// Nothing runs until the reader confirms.
export function RecipeDialog({ isOpen, link, state, error, isRunning, canRun, onLoad, onDismiss }: Props) {
  const isMobile = useIsMobile();
  const page = (title: string) => <TextLink href={recipePageUrl(link)}>{title}</TextLink>;
  const loadable = state.kind === 'whole' || state.kind === 'step';
  const { whole, part, parts } = NOUNS[link.source];
  const where = link.source === 'docs' ? 'docs' : 'cookbook';
  return (
    <Dialog isOpen={isOpen} hasDisabledCloseButton size={isMobile ? 'small' : 'medium'} onClose={() => {}}>
      <Dialog.Header>{link.cell === null ? `Open a ${where} ${whole}` : `Open a ${where} ${part}`}</Dialog.Header>
      <Dialog.Content>
        {state.kind === 'loading' && <Typography variant="body-medium">Loading the {whole}…</Typography>}
        {state.kind === 'failed' && (
          <Typography variant="body-medium" className="n-text-danger-text">
            {state.message}
          </Typography>
        )}
        {state.kind === 'missing-step' && (
          <Typography variant="body-medium">
            The {whole} {page(state.recipe.title)} has no {part} named <code>{link.cell}</code>.
          </Typography>
        )}
        {state.kind === 'whole' && (
          <Typography variant="body-medium">
            {page(state.recipe.title)}. Loading it runs all {state.replay.length} of its {parts}, in order, in this
            tab's in-memory database, then leaves the editor empty so you can query the graph the {whole} builds.
            Nothing leaves your browser.
          </Typography>
        )}
        {state.kind === 'step' && (
          <>
            <Typography variant="body-medium">
              {part === 'step' ? 'Step' : 'Cell'} <code>{state.target.id}</code> of {page(state.recipe.title)}. Loading it runs the{' '}
              {state.replay.length} earlier {state.replay.length === 1 ? part : parts} in this tab's in-memory
              database, then puts this {part} in the editor for you to run and change. Nothing leaves your browser.
            </Typography>
            {state.target.paramsPath && (
              <div className="n-mt-3">
                <Typography variant="body-medium">
                  This {part} uses the parameters in <code>{state.target.paramsPath}</code>. The playground passes
                  them with every query until you clear them or reset the database.
                </Typography>
              </div>
            )}
            <Box
              borderRadius="md"
              className="n-mt-3 n-border n-border-neutral-border-weak n-bg-neutral-bg-weak relate-cm"
              style={{ maxHeight: isMobile ? 200 : 260, maxWidth: '100%', overflow: 'auto' }}
            >
              <CypherEditor value={state.target.code} theme="dark" readonly lineWrap />
            </Box>
          </>
        )}
        {error && (
          <div className="n-mt-3">
            <Typography variant="body-medium" className="n-text-danger-text">
              {error}
            </Typography>
          </div>
        )}
      </Dialog.Content>
      <Dialog.Actions>
        <OutlinedButton onClick={onDismiss} isDisabled={isRunning}>
          Use the sample data instead
        </OutlinedButton>
        <FilledButton onClick={onLoad} isDisabled={!canRun || !loadable || isRunning} isLoading={isRunning}>
          Load the {whole}
        </FilledButton>
      </Dialog.Actions>
    </Dialog>
  );
}
