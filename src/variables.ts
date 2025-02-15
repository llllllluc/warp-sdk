import { warp_controller } from './types';
import jsonpath from 'jsonpath';
import { isObject } from 'lodash';
import axios, { AxiosRequestConfig } from 'axios';

export const extractVariableName = (str: string) => {
  const prefix = '$warp.variable.';
  return str.substring(prefix.length);
};

export const variableName = (v: warp_controller.Variable): string => {
  if ('static' in v) {
    return v.static.name;
  }

  if ('external' in v) {
    return v.external.name;
  }

  return v.query.name;
};

export const resolveExternalVariable = async (external: warp_controller.ExternalVariable): Promise<string> => {
  const { init_fn } = external;
  const { body = null, method = 'get', selector, url, headers = {} } = init_fn;

  const options: AxiosRequestConfig = {
    method: method.toUpperCase(),
    url,
    data: body ? JSON.parse(body) : undefined,
    headers: {
      'Accept-Encoding': 'identity',
      ...headers,
    },
  };

  try {
    const resp = await axios.request({ ...options, responseType: 'json' });
    const extracted = jsonpath.query(resp.data, selector);

    if (extracted[0] == null) {
      return null;
    } else {
      const v = extracted[0];

      if (isObject(v)) {
        return JSON.stringify(v);
      } else {
        return String(v);
      }
    }
  } catch (error) {
    console.error(`Error resolving external variable: ${error.message}`);
    return null;
  }
};

const resolveExternalInput = async (
  external: warp_controller.ExternalVariable
): Promise<warp_controller.ExternalInput> => {
  const input = await resolveExternalVariable(external);

  return { name: external.name, input };
};

export const resolveExternalInputs = async (
  variables: warp_controller.Variable[]
): Promise<warp_controller.ExternalInput[]> => {
  const externals = variables.filter((v) => 'external' in v) as Extract<warp_controller.Variable, { external: {} }>[];

  return Promise.all(externals.map((e) => resolveExternalInput(e.external)));
};
