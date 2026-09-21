export const shouldSyncPendingStatements = (
  previousStatements: string[],
  editedStatements: string[],
  nextStatements: string[]
) => {
  const listsMatch = (left: string[], right: string[]) => (
    left.length === right.length && left.every((statement, index) => statement === right[index])
  );

  if (listsMatch(previousStatements, nextStatements)) {
    return false;
  }

  return previousStatements.length !== nextStatements.length
    || listsMatch(previousStatements, editedStatements);
};
