import Spreadsheet from "../models/spreadsheet";
import {
  reduceInputObjectType,
  reduceMutationArguments,
  reduceType,
  buildObjectTypeParams
} from "../utils/type-map-utils";
import {
  GraphQLField,
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLNamedType
} from "graphql";
import * as get from "lodash/fp/get";
import * as has from "lodash/fp/has";
import * as isEmpty from "lodash/fp/isEmpty";
import extractRelationships from "../utils/extract-relationships";
import { IGenericPayload, IRelationship } from "../Interfaces";
import replaceFormulasAndFlatten from "../utils/replace-formulas-and-flatten";

const { isArray } = Array;

export default function createRecordResolver(
  spreadsheet: Spreadsheet,
  mutation: GraphQLField<string, any>
) {
  return async function createRecord(_, payload: IGenericPayload) {
    /**
     * Creating records quires IDs on each object. Here we will,
     * create recursively travers the payload and add ids to all
     * future records.
     */
    let withIds = injectIds(mutation, payload, {
      generateId: () => spreadsheet.newId()
    });

    /**
     * Creating relationships before creating records will make it possible
     * for us to retrieve the values of relationship formulas with the created
     * records.
     */
    let relationships = extractRelationships(
      mutation,
      withIds
    ).map(([from, id, on, to, target]: IRelationship) => {
      return spreadsheet.createRelationship(from, id, on, to, target);
    });

    if (!isEmpty(relationships)) {
      await Promise.all(relationships);
    }

    let created = replaceFormulasAndFlatten(
      mutation,
      withIds
    ).map(async ([type, data]) => {
      return spreadsheet.createRecord(type, data);
    });

    if (!isEmpty(created)) {
      let [root] = await Promise.all(created);
      return root;
    }
  };
}

export function injectIds(mutation, payload, actions) {
  return reduceMutationArguments(
    mutation,
    (result, argName, argType: GraphQLInputObjectType, argInfo) => {
      let root = get(argName, payload);
      if (root) {
        return {
          ...result,
          [argName]: inputTraverser(argType, root, actions)
        };
      }
      return result;
    }
  );
}

interface TraverserActions {
  generateId: () => string;
}

function inputTraverser(
  inputType: GraphQLInputObjectType,
  payload: IGenericPayload,
  actions: TraverserActions
) {
  return reduceInputObjectType(
    inputType,
    (
      result,
      inputProp,
      inputField: GraphQLInputObjectType,
      { isList, isInput, isScalar }
    ) => {
      let value = get(inputProp, payload);
      if (inputProp === "id") {
        return {
          ...result,
          id: value || actions.generateId()
        };
      }
      if (isScalar && has(inputProp, payload)) {
        return {
          ...result,
          [inputProp]: value
        };
      }
      if (isInput && value) {
        if (isList) {
          return {
            ...result,
            [inputProp]: value.map(item =>
              inputTraverser(inputField, item, actions)
            )
          };
        } else {
          return {
            ...result,
            [inputProp]: inputTraverser(inputField, value, actions)
          };
        }
      }
      return result;
    }
  );
}
