/**
 * Shared inline-CSS building blocks for the DOM-based auth screens
 * (LoginScene, RegisterScene, SettingsScene) — same parchment/RPG look,
 * reused instead of repeating the same ~15 declarations in every scene's
 * template literal.
 */

export const AUTH_PANEL_STYLE = `
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px 40px;
  background: rgba(20, 16, 12, 0.92);
  border: 2px solid #8a7346;
  border-radius: 6px;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.6);
  font-family: Georgia, 'Times New Roman', serif;
  color: #e8dcc0;
  width: 260px;
`;

export const AUTH_LABEL_STYLE = `
  align-self: flex-start;
  font-size: 14px;
  letter-spacing: 1px;
`;

export const AUTH_INPUT_STYLE = `
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 16px;
  font-family: inherit;
  background: #1c1712;
  border: 1px solid #8a7346;
  border-radius: 3px;
  color: #f2e9d0;
  outline: none;
`;

export const AUTH_ERROR_STYLE = `
  color: #d94f4f;
  font-size: 12px;
  min-height: 14px;
  visibility: hidden;
`;

export const AUTH_PRIMARY_BUTTON_STYLE = `
  width: 100%;
  padding: 10px 0;
  font-size: 16px;
  font-family: inherit;
  letter-spacing: 1px;
  background: #3a7d34;
  border: 1px solid #274f22;
  border-radius: 3px;
  color: #f2e9d0;
  cursor: pointer;
`;

export const AUTH_SECONDARY_BUTTON_STYLE = `
  width: 100%;
  padding: 10px 0;
  font-size: 15px;
  font-family: inherit;
  letter-spacing: 1px;
  background: #4a3f2f;
  border: 1px solid #8a7346;
  border-radius: 3px;
  color: #f2e9d0;
  cursor: pointer;
`;
