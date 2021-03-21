#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { AutomuteusAwsDeploymentStack } from '../lib/automuteus-aws-deployment-stack';

const app = new cdk.App();
new AutomuteusAwsDeploymentStack(app, 'AutomuteusAwsDeploymentStack');
