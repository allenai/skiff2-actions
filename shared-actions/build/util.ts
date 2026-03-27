const CAPTURE_INSIDE_BRACES_REGEX = /\$\{(.*)\}/g

type Replacements = { [variableName: string]: string}

/**
 * 
 * @param valueToExpand A string with variables enclosed like ${VARIABLE}
 * @param replacements An object with variable names as keys and the value to replace them with as the value
 * @returns valueToExpand with specified variables expanded
 * @example
 * // returns 'Hello world!'
 * expandVariables('Hello ${LOCATION_NAME}!', { LOCATION_NAME: 'world'})
 */
export function expandVariables(
  valueToExpand: string,
  replacements: Replacements,
): string {
  const bracesRegex = new RegExp(
    Object.keys(replacements).map(
      (replacementKey) => "\\$\\{" + replacementKey + "\\}",
    ).join("|"),
    "g",
  );

  const expandedValue = valueToExpand.replace(bracesRegex, (matchedValue) => {
    const replacementKey = matchedValue.replaceAll(
      CAPTURE_INSIDE_BRACES_REGEX,
      "$1",
    ) as keyof typeof replacements;

    return replacements[replacementKey];
  });

  return expandedValue;
}
