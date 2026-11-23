// The least a site can give the report: a name, a scale with type roles, one stylesheet and one block. No rounds, no
// palette, no decisions, no questions, no checks yet, no aliases, line heights or tracking in the scale.
export default {
  name: "Minimal",
  live: "https://example.org/",
  report: { blocks: [{ id: "hero", title: "Hero", selector: ".hero", files: ["src/styles/site.css"] }, { id: "foot", title: "Footer", selector: "footer", files: ["src/index.html"] }] },
};
