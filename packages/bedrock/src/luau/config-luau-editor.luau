--!nocheck
-- Reads the luau.aliases entries of a .config.luau and produces its source
-- with one alias set, splicing text so everything else stays as written.
-- Arguments: source path, alias name, alias target. Writes one sentinel
-- followed by a JSON payload to stdout.
local fs = require("@std/fs")
local io = require("@std/io")
local json = require("@std/json")
local process = require("@std/process")
local syntax = require("@std/syntax")

local KEYWORDS = {
	["and"] = true, ["break"] = true, ["do"] = true, ["else"] = true, ["elseif"] = true,
	["end"] = true, ["false"] = true, ["for"] = true, ["function"] = true, ["if"] = true,
	["in"] = true, ["local"] = true, ["nil"] = true, ["not"] = true, ["or"] = true,
	["repeat"] = true, ["return"] = true, ["then"] = true, ["true"] = true, ["until"] = true,
	["while"] = true,
}

local function emit(payload)
	io.write("__BEDROCK_CONFIG_LUAU__")
	io.write(json.serialize(payload))
end

local source = fs.readFileToString(process.args[2])
local alias = process.args[3]
local target = process.args[4]

local lineStarts = { 1 }
for position in string.gmatch(source, "()\n") do
	table.insert(lineStarts, position + 1)
end

local function offset(line, column)
	return lineStarts[line] + column - 1
end

local function lineIndent(line)
	return string.match(source, "^[ \t]*", lineStarts[line])
end

local function keyOf(entry)
	if entry.kind == "record" then
		return entry.key.text
	end
	if entry.kind == "general" and entry.key.tag == "string" then
		return entry.key.value.text
	end
	return nil
end

local function find(tbl, name)
	local found = nil
	for _, entry in tbl.entries do
		if keyOf(entry) == name then
			found = entry
		end
	end
	return found
end

local function quote(text)
	return string.format("%q", text)
end

local function keyText(name)
	if string.match(name, "^[%a_][%w_]*$") and not KEYWORDS[name] then
		return name
	end
	return "[" .. quote(name) .. "]"
end

local function splice(at, text)
	return string.sub(source, 1, at - 1) .. text .. string.sub(source, at)
end

local function addEntry(tbl, entryText)
	local entries = tbl.entries
	local openBrace = tbl.openBrace.location
	if #entries == 0 then
		return splice(offset(openBrace.endLine, openBrace.endColumn), " " .. entryText .. " ")
	end

	local last = entries[#entries]
	local closeLine = tbl.closeBrace.location.beginLine
	local separator = last.separator
	if separator ~= nil then
		local after = separator.location
		if closeLine > after.endLine then
			return splice(lineStarts[after.endLine + 1], lineIndent(last.location.beginLine) .. entryText .. ",\n")
		end
		return splice(offset(after.endLine, after.endColumn), " " .. entryText .. ",")
	end

	local after = last.location
	if closeLine > after.endLine then
		return splice(offset(after.endLine, after.endColumn), ",\n" .. lineIndent(after.beginLine) .. entryText)
	end
	return splice(offset(after.endLine, after.endColumn), ", " .. entryText)
end

local parsed, result = pcall(syntax.parse, source)
if not parsed then
	local message = string.gsub(string.gsub(tostring(result), "^.-parsing failed:%s*", ""), "%s+$", "")
	emit({ kind = "uneditable", reason = "it does not parse: " .. message })
	return
end

local returned = nil
for _, statement in result.root.statements do
	if statement.tag == "return" then
		returned = statement
	end
end
if returned == nil or #returned.expressions ~= 1 or returned.expressions[1].tag ~= "table" then
	emit({ kind = "uneditable", reason = "it does not return a table literal" })
	return
end

local root = returned.expressions[1]
local wantedEntry = keyText(alias) .. " = " .. quote(target)
local luauEntry = find(root, "luau")
if luauEntry == nil then
	emit({ kind = "editable", aliases = {}, edited = addEntry(root, "luau = { aliases = { " .. wantedEntry .. " } }") })
	return
end
if luauEntry.value.tag ~= "table" then
	emit({ kind = "uneditable", reason = "its luau entry is not a table literal" })
	return
end

local aliasesEntry = find(luauEntry.value, "aliases")
if aliasesEntry == nil then
	emit({ kind = "editable", aliases = {}, edited = addEntry(luauEntry.value, "aliases = { " .. wantedEntry .. " }") })
	return
end
if aliasesEntry.value.tag ~= "table" then
	emit({ kind = "uneditable", reason = "its luau.aliases entry is not a table literal" })
	return
end

local aliases = {}
for _, entry in aliasesEntry.value.entries do
	local name = keyOf(entry)
	if name ~= nil then
		table.insert(aliases, {
			name = name,
			target = if entry.value.tag == "string" then entry.value.value.text else false,
		})
	end
end

local existing = find(aliasesEntry.value, alias)
if existing == nil then
	emit({ kind = "editable", aliases = aliases, edited = addEntry(aliasesEntry.value, wantedEntry) })
	return
end
if existing.value.tag ~= "string" then
	emit({ kind = "editable", aliases = aliases, edited = source })
	return
end

local at = existing.value.location
emit({
	kind = "editable",
	aliases = aliases,
	edited = string.sub(source, 1, offset(at.beginLine, at.beginColumn) - 1)
		.. quote(target)
		.. string.sub(source, offset(at.endLine, at.endColumn)),
})
